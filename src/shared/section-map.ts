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
