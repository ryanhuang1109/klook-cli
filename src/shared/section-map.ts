/**
 * Returns a JS code snippet (string) that defines `standardizeSectionTitle(original)`
 * for embedding inside page.evaluate() calls.
 *
 * Maps platform-specific section names → Klook-standard titles.
 * Returns { standard: string, original: string }.
 */
export function getSectionMapJs(): string {
  return `
    const __SECTION_RULES__ = [
      { p: /^overview$|^about/i,                                       s: 'Overview' },
      { p: /highlight/i,                                               s: 'Highlights' },
      { p: /what to expect|^experience$/i,                             s: 'What to expect' },
      { p: /what.?s included|^includes?$|what you.?ll get|inclusions/i,s: "What's included" },
      { p: /what.?s excluded|not included|^excludes?$|exclusions/i,    s: "What's excluded" },
      { p: /itinerary|schedule|route|timeline/i,                       s: 'Itinerary' },
      { p: /how to use|how it works|redemption/i,                      s: 'How to use' },
      { p: /meeting point|how to get there/i,                          s: 'Location' },
      { p: /cancell?ation|refund/i,                                    s: 'Cancellation policy' },
      { p: /additional info|notice|important info|good to know|need to know/i, s: 'Additional info' },
      { p: /^location$|^address$/i,                                    s: 'Location' },
      { p: /faq|frequently|question/i,                                 s: 'FAQ' },
    ];
    function standardizeSectionTitle(orig) {
      const t = (orig || '').trim();
      for (const r of __SECTION_RULES__) { if (r.p.test(t)) return { standard: r.s, original: t }; }
      return { standard: t, original: t };
    }
  `;
}

/**
 * Returns a JS snippet defining `extractSectionUntilNextHeading(headingEl)` — extracts
 * the content between a heading and the next heading at the same DOM level, instead
 * of the parent `<section>` (which over-captures on apps like KKday/Airbnb where
 * many headings share one section element).
 *
 * Falls back to `headingEl.closest(fallbackSelector)` only if the section it returns
 * doesn't itself contain 3+ headings (i.e. we accept "small" parent sections).
 */
export function getSectionWalkerJs(): string {
  return `
    function extractSectionUntilNextHeading(headingEl, fallbackSelector) {
      const parent = headingEl.parentElement;
      if (!parent) return '';
      const children = Array.from(parent.children);
      const idx = children.indexOf(headingEl);
      if (idx === -1) return '';
      let collected = '';
      for (let i = idx + 1; i < children.length; i++) {
        const el = children[i];
        if (/^H[1-6]$/.test(el.tagName)) break;
        if (el.querySelector && el.querySelector('h1,h2,h3,h4,h5,h6')) break;
        collected += ' ' + (el.textContent || '');
      }
      collected = collected.trim();
      if (collected.length >= 5) return collected;
      // Fallback: closest enclosing section, but only if it isn't already over-stuffed.
      if (!fallbackSelector) return '';
      const fallback = headingEl.closest(fallbackSelector);
      if (!fallback) return '';
      const headingsIn = fallback.querySelectorAll ? fallback.querySelectorAll('h1,h2,h3,h4,h5,h6').length : 0;
      if (headingsIn > 3) return '';
      return (fallback.textContent || '').trim();
    }
  `;
}

/**
 * Returns a JS snippet defining `extractCancellationFromBody(bodyText)` for use inside
 * page.evaluate(). Scans free-form body text for cancellation/refund patterns and returns
 * a short policy string, or '' if nothing matches. Intended as a per-platform safety net
 * when the section walker can't reach the policy (e.g. Trip's collapsed FAQ accordion).
 */
export function getCancellationExtractorJs(): string {
  return `
    function extractCancellationFromBody(bodyText) {
      const text = String(bodyText || '');
      // Stop tokens — where the cancellation chunk visually ends. Picked from observed
      // siblings on Klook/Trip/GYG/KKday booking pages.
      const stopRe = /(Reserve now|Duration\\s*[:\\s]?\\d|Check availability|Live tour guide|Highlighted reviews|About this activity|Reschedule|How to use|Voucher type|Voucher validity|Notice\\s|Important note|FAQ\\s|Before you book|Pick-up|Confirmation\\b|Includes\\/Excludes|Includes:|Excludes:|Itinerary|Meeting Point|Package Description|Validity Period|Reminders|Policy Info|You might also like|Customer reviews|See more activities)/;
      const patterns = [
        /(?:Cancellation|Refund)\\s+policy[:\\s]+([\\s\\S]{20,1500})/i,
        /(Free\\s+cancellation[\\s\\S]{0,500})/i,
        /(Cancel\\s+up\\s+to\\s+\\d+\\s+(?:hour|day|business day)[\\s\\S]{0,500})/i,
        /(Non[-\\s]?refundable[\\s\\S]{0,400})/i,
        /(No\\s+(?:cancell?ation|refund)s?[\\s\\S]{0,400})/i,
      ];
      for (const re of patterns) {
        const m = text.match(re);
        if (!m || !m[1]) continue;
        let chunk = m[1];
        const stop = chunk.match(stopRe);
        if (stop && stop.index !== undefined) chunk = chunk.slice(0, stop.index);
        const cleaned = chunk.trim().replace(/\\s+/g, ' ').slice(0, 2000);
        if (cleaned.length >= 15) return cleaned;
      }
      return '';
    }
  `;
}
