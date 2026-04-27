/**
 * kkday/detail — KKday activity detail with package pricing.
 *
 * KKday has rich package structure: category tabs (Admission, Bundle, VIP)
 * with h3 package names and price elements. Product URL: /en/product/{id}
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/registry';
import { parseActivityDetail } from '../../shared/parsers.js';
import { getSectionMapJs, getCancellationExtractorJs, getSectionWalkerJs } from '../../shared/section-map.js';
import { captureActivityScreenshot } from '../../shared/capture-activity-screenshot.js';

export function parseProductId(input: string): string {
  const urlMatch = input.match(/\/product\/(\d+)/);
  if (urlMatch) return urlMatch[1];
  if (/^\d+$/.test(input.trim())) return input.trim();
  return input;
}

export function buildDetailEvaluate(): string {
  return `
    (async () => {
      const str = (v) => v == null ? '' : String(v).trim();
      ${getSectionMapJs()}
      ${getCancellationExtractorJs()}
      ${getSectionWalkerJs()}

      const title = str(document.querySelector('h1')?.textContent);
      const description = str(
        document.querySelector('meta[name="description"]')?.getAttribute('content')
      );

      // Rating + reviews + bookings
      const bodyText = document.body.innerText;
      const ratingMatch = bodyText.match(/(\\d\\.\\d)\\s*(?:\\(|\\/)/) || bodyText.match(/(\\d\\.\\d)/);
      const starScore = ratingMatch ? ratingMatch[1] : '';
      const reviewMatch = bodyText.match(/([\\d,]+[KkMm]?)\\+?\\s*reviews?/i);
      const reviewCount = reviewMatch ? reviewMatch[0] : '';

      // KKday shows bookings as "X+ booked" / "X travelers booked" / "Sold X+"
      let bookCount = '';
      const bookMatch =
        bodyText.match(/([\\d,.]+[KkMm]?\\+?)\\s+travel(?:ers|lers)\\s+booked/i) ||
        bodyText.match(/([\\d,.]+[KkMm]?\\+?)\\s+booked/i) ||
        bodyText.match(/Sold\\s+([\\d,.]+[KkMm]?\\+?)/i);
      if (bookMatch) bookCount = bookMatch[1];

      // Supplier — KKday labels the operator as "Supplier", "Operated by",
      // or 供應商. Require a company-name suffix to avoid noise.
      let supplier = '';
      const supRegex =
        /(?:Supplier|Operated by|Provided by|供應商|供应商)\\s*[:\\-]?\\s*([^\\n]{2,120}?(?:株式会社|有限会社|合同会社|有限公司|Ltd\\.?|LLC|Inc\\.?|Co\\.?,?\\s*Ltd\\.?|Corporation|Tours|Travel|Group|GmbH|SA|SAS|Pty\\.?|Pvt\\.?|旅行社|旅遊))/i;
      const supMatch = bodyText.match(supRegex);
      if (supMatch) {
        supplier = supMatch[1].trim().replace(/^[:\\s\\-]+/, '').slice(0, 120);
      }

      // Images
      const seenImgs = new Set();
      const images = Array.from(document.querySelectorAll('img[src*="kkday"], img[src*="cdn"]'))
        .map((img) => img.src)
        .filter((src) => (src.includes('product') || src.includes('image')) && !seenImgs.has(src) && (seenImgs.add(src), true))
        .slice(0, 10);

      // ── Sections: capture all h2/h3 sections ──
      const sections = [];
      const seenSections = new Set();
      const allHeadings = Array.from(document.querySelectorAll('h2, h3'));

      for (const h of allHeadings) {
        const orig = str(h.textContent);
        if (!orig || orig.length > 100 || seenSections.has(orig.toLowerCase())) continue;
        // Skip package-like h3 headings (those are handled below)
        if (h.tagName === 'H3' && /pass|ticket|tour|bundle|voucher|vip|admission/i.test(orig)) continue;
        seenSections.add(orig.toLowerCase());
        // Use sibling-walk first — KKday's closest('section') over-captures
        // because many h2/h3 share one outer section element (Cancellation
        // Policy ends up holding the entire page). Fall back to the closest
        // section only if it is small enough.
        const rawContent = extractSectionUntilNextHeading(
          h,
          'section, [class*="section"], [class*="module"], [class*="content-block"]'
        );
        const content = str(rawContent)
          .replace(orig, '').replace(/Show (more|less)/gi, '').replace(/See (more|less)/gi, '').replace(/Read (more|less)/gi, '')
          .trim().slice(0, 2000);
        if (content.length < 5) continue;
        const m = standardizeSectionTitle(orig);
        sections.push({ title: m.standard, original_title: m.original, content });
      }

      // ── Inclusions / Exclusions ──
      let inclusions = [], exclusions = [];
      const inclH = allHeadings.find(h => /included|what you.?ll get|inclusions/i.test(str(h.textContent)));
      if (inclH) {
        const sec = inclH.closest('section, [class*="section"], [class*="module"]') || inclH.parentElement;
        const lists = sec?.querySelectorAll('ul') || [];
        if (lists.length >= 2) {
          inclusions = Array.from(lists[0].querySelectorAll('li')).map(l => str(l.textContent)).filter(Boolean);
          exclusions = Array.from(lists[1].querySelectorAll('li')).map(l => str(l.textContent)).filter(Boolean);
        } else if (lists.length === 1) {
          inclusions = Array.from(lists[0].querySelectorAll('li')).map(l => str(l.textContent)).filter(Boolean);
        }
      }
      // Separate exclusions heading
      if (!exclusions.length) {
        const exclH = allHeadings.find(h => /not included|excludes|excluded|exclusions/i.test(str(h.textContent)));
        if (exclH) {
          const sec = exclH.closest('section, [class*="section"]') || exclH.parentElement;
          const list = sec?.querySelector('ul');
          if (list) exclusions = Array.from(list.querySelectorAll('li')).map(l => str(l.textContent)).filter(Boolean);
        }
      }

      // ── Itinerary ──
      const itinerary = [];
      const itinH = allHeadings.find(h => /itinerary|schedule|timeline/i.test(str(h.textContent)));
      if (itinH) {
        const sec = itinH.closest('section, [class*="section"], [class*="module"]') || itinH.parentElement;
        const items = sec?.querySelectorAll('[class*="step"], [class*="timeline"], [class*="item"], li') || [];
        const seenItin = new Set();
        for (const item of Array.from(items).slice(0, 30)) {
          const text = str(item.textContent).slice(0, 300);
          if (!text || seenItin.has(text)) continue;
          seenItin.add(text);
          const timeMatch = text.match(/(\\d{1,2}:\\d{2})/);
          itinerary.push({
            time: timeMatch ? timeMatch[1] : '',
            title: text.replace(timeMatch?.[0] || '', '').trim().slice(0, 200),
            description: '',
          });
        }
      }

      // ── Packages ──
      // h3 headings that look package-ish. Skip help/instructional sections
      // (how-to, voucher redemption, terms) and anything beyond the
      // "you might also like" / "related products" boundary — those are
      // carousel entries for DIFFERENT products, not packages of this tour.
      const INSTRUCTION_RE = /^(how to|when to|why|before |after |please |note |important |terms |faq |voucher (?:redemption|period|use|refund|policy))/i;

      // Relevance filter: require the package h3 to share at least one
      // distinctive word with the activity title. Related-product carousels
      // (TeamLab, SHIBUYA SKY etc.) share prices + "Ticket"/"Tour" labels
      // with real variants but don't share POI keywords.
      const COMMON = new Set(['tour','day','trip','ticket','pass','private','experience','tokyo','japan','from','with','the','and','guaranteed','departure','option','including']);
      const titleKeywords = new Set(
        (title.toLowerCase().match(/[a-z\\u4e00-\\u9fff]{3,}/g) || [])
          .filter((w) => !COMMON.has(w))
      );

      const h3s = Array.from(document.querySelectorAll('h3'));
      const packages = [];
      for (const h3 of h3s) {
        // Require relevance to the activity title
        const h3Lower = str(h3.textContent).toLowerCase();
        const hasRelevance = titleKeywords.size === 0 ||
          Array.from(titleKeywords).some((kw) => h3Lower.includes(kw));
        if (!hasRelevance) continue;
        let name = str(h3.textContent);
        if (!name || name.length < 5 || name.length > 200) continue;
        if (INSTRUCTION_RE.test(name)) continue;
        if (!/pass|ticket|tour|bundle|voucher|nintendo|vip|admission|experience/i.test(name)) continue;
        // Clean "Use instantly" suffix
        name = name.replace(/Use instantly$/i, '').trim();

        // Find price near this heading
        const parent = h3.closest('[class*="package"], [class*="option"], section, li, article') || h3.parentElement;
        let price = '';
        if (parent) {
          const priceEl = parent.querySelector('[class*="price"]');
          if (priceEl) {
            const priceText = str(priceEl.textContent).replace(/\\n/g, ' ');
            const match = priceText.match(/((?:US|TWD|HK|JPY|EUR)\\$?\\s*[\\d,.]+)/);
            price = match ? match[1] : '';
          }
        }

        // Skip entries without a price — those are almost always instruction
        // blocks, booking-policy sections, or related-products teasers.
        if (!price) continue;

        // Check availability
        const parentText = str(parent?.textContent || '');
        const soldOut = /sold out|unavailable/i.test(parentText);
        const bookingStart = parentText.match(/Booking starts:\\s*([\\d-]+)/)?.[1] || '';

        // Package description from nearby description element
        const descEl = parent?.querySelector('[class*="desc"], [class*="info"], [class*="detail"], p');
        const pkgDesc = descEl ? str(descEl.textContent).slice(0, 500) : (bookingStart ? 'Booking starts: ' + bookingStart : '');

        packages.push({
          name,
          description: pkgDesc,
          inclusions,
          exclusions,
          price,
          currency: price.match(/^[A-Z]+\\$?/)?.[0] || '',
          originalPrice: '',
          discount: '',
          date: bookingStart || '',
          availability: soldOut ? 'Sold out' : 'Available',
        });
      }

      // Cancellation policy: trust the direct section only when it looks
      // substantial (≥50 chars OR contains policy keywords). Some KKday
      // layouts put the heading in one branch and the actual policy text in
      // a different DOM branch — sibling-walk finds only a useless stub like
      // "Designated handling fee", in which case we fall back to body-text.
      const cancelSection = sections.find((s) => s.title === 'Cancellation policy');
      const directContent = cancelSection ? cancelSection.content : '';
      const looksSubstantial =
        directContent.length >= 50 ||
        /(?:free\\s+cancell|refund|day\\(s\\)|hours?\\s+before)/i.test(directContent);
      let cancellationPolicy = (looksSubstantial && directContent.length < 800)
        ? directContent
        : '';
      if (!cancellationPolicy) cancellationPolicy = extractCancellationFromBody(bodyText);

      return {
        title,
        description,
        cityName: '',
        categoryName: '',
        starScore,
        reviewCount,
        bookCount,
        supplier,
        images,
        itinerary,
        packages,
        sections,
        cancellationPolicy,
        url: location.href,
      };
    })()
  `;
}

cli({
  site: 'kkday',
  name: 'get-activity',
  aliases: ['detail'],
  description: 'Show KKday activity detail with package pricing',
  domain: 'www.kkday.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'product', required: true, positional: true, help: 'Product ID or URL (e.g. "2247" or full KKday URL)' },
    { name: 'screenshot', help: 'Capture viewport screenshot. Value: "auto" (data/screenshots/<platform>-<id>.png), "base64" (inline), or a file path' },
  ],
  columns: ['title', 'rating', 'review_count'],
  defaultFormat: 'json',
  func: async (page: IPage, kwargs) => {
    const input = String(kwargs.product || '').trim();
    if (!input) throw new Error('Product ID or URL is required');

    const productId = parseProductId(input);
    const url = input.startsWith('http')
      ? input
      : `https://www.kkday.com/en/product/${productId}`;

    await page.goto(url);
    await page.wait(5000);
    await page.autoScroll({ times: 3, delayMs: 1500 });

    // Walk dropdowns in the booking widget — KKday exposes time-slot,
    // language, and package-tier pickers the same way GYG/Trip do.
    const dimensions = await page.evaluate(`
      (async () => {
        const str = (v) => v == null ? '' : String(v).trim().replace(/\\s+/g, ' ');
        const delay = (ms) => new Promise(r => setTimeout(r, ms));
        const BLOCK = /^(most recent|highest rated|sort|filter|see all|show more|read more|share|save|close|help|login|sign in)$/i;

        // Anchor on the booking container if present, else the whole body.
        const booking =
          document.querySelector('[class*="booking"], [class*="buy-box"], [class*="product-option"], [class*="sku"]') ||
          document.body;

        const triggers = Array.from(booking.querySelectorAll(
          '[aria-haspopup], [aria-expanded], button[class*="select"], button[class*="dropdown"], button[class*="picker"]'
        )).filter((el) => {
          const t = str(el.textContent);
          return t && t.length > 0 && t.length < 80 && !BLOCK.test(t);
        });

        const seen = new Set();
        const dims = [];
        for (const trigger of triggers.slice(0, 6)) {
          const label = str(trigger.textContent);
          if (seen.has(label)) continue;
          seen.add(label);
          try {
            trigger.click();
            await delay(500);
            const optEls = Array.from(document.querySelectorAll(
              '[role="option"], [role="radio"], [role="menuitem"]'
            ));
            const opts = Array.from(new Set(
              optEls.map((el) => str(el.textContent)).filter((t) => t && t.length < 120 && !BLOCK.test(t))
            ));
            if (opts.length >= 2) dims.push({ label, selected: label, options: opts.slice(0, 20) });
            document.body.click();
            await delay(250);
          } catch (e) {}
        }
        return { dimensions: dims };
      })()
    `) as any;

    const raw = await page.evaluate(buildDetailEvaluate()) as any;
    if (!raw || !raw.title) {
      throw new Error('Could not extract product detail from KKday.');
    }
    if (dimensions && Array.isArray(dimensions.dimensions)) {
      raw.option_dimensions = dimensions.dimensions;
    }
    const detail = parseActivityDetail(raw);
    const shot = await captureActivityScreenshot(page, 'kkday', productId, kwargs.screenshot as string | undefined);
    return { ...detail, ...shot };
  },
});

export const __test__ = { parseProductId };
