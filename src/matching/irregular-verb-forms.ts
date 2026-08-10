/**
 * Map from base-form verbs to their irregular inflected forms.
 * Used by sentence-utils to match conjugated forms in sentences
 * (e.g., "wear" → "wore", "go" → "went").
 */
const IRREGULAR_VERB_FORMS: Record<string, string[]> = {
  be: ["am", "is", "are", "was", "were", "been", "being"],
  beat: ["beat", "beaten", "beating"],
  become: ["became", "becoming"],
  begin: ["began", "begun", "beginning"],
  bite: ["bit", "bitten", "biting"],
  blow: ["blew", "blown", "blowing"],
  break: ["broke", "broken", "breaking"],
  bring: ["brought", "bringing"],
  build: ["built", "building"],
  buy: ["bought", "buying"],
  catch: ["caught", "catching"],
  choose: ["chose", "chosen", "choosing"],
  come: ["came", "coming"],
  cost: ["cost", "costing"],
  cut: ["cut", "cutting"],
  dig: ["dug", "digging"],
  do: ["did", "done", "does", "doing"],
  draw: ["drew", "drawn", "drawing"],
  drink: ["drank", "drunk", "drinking"],
  drive: ["drove", "driven", "driving"],
  eat: ["ate", "eaten", "eating"],
  fall: ["fell", "fallen", "falling"],
  feed: ["fed", "feeding"],
  feel: ["felt", "feeling"],
  fight: ["fought", "fighting"],
  find: ["found", "finding"],
  fly: ["flew", "flown", "flying"],
  forget: ["forgot", "forgotten", "forgetting"],
  forgive: ["forgave", "forgiven", "forgiving"],
  freeze: ["froze", "frozen", "freezing"],
  get: ["got", "gotten", "getting"],
  give: ["gave", "given", "giving"],
  go: ["went", "gone", "goes", "going"],
  grow: ["grew", "grown", "growing"],
  hang: ["hung", "hanging"],
  have: ["had", "has", "having"],
  hear: ["heard", "hearing"],
  hide: ["hid", "hidden", "hiding"],
  hit: ["hit", "hitting"],
  hold: ["held", "holding"],
  hurt: ["hurt", "hurting"],
  keep: ["kept", "keeping"],
  know: ["knew", "known", "knowing"],
  lay: ["laid", "laying"],
  lead: ["led", "leading"],
  leave: ["left", "leaving"],
  lend: ["lent", "lending"],
  let: ["let", "letting"],
  lie: ["lay", "lain", "lying"],
  light: ["lit", "lighting"],
  lose: ["lost", "losing"],
  make: ["made", "making"],
  mean: ["meant", "meaning"],
  meet: ["met", "meeting"],
  pay: ["paid", "paying"],
  put: ["put", "putting"],
  read: ["read", "reading"],
  ride: ["rode", "ridden", "riding"],
  ring: ["rang", "rung", "ringing"],
  rise: ["rose", "risen", "rising"],
  run: ["ran", "running"],
  say: ["said", "says", "saying"],
  see: ["saw", "seen", "seeing"],
  seek: ["sought", "seeking"],
  sell: ["sold", "selling"],
  send: ["sent", "sending"],
  set: ["set", "setting"],
  shake: ["shook", "shaken", "shaking"],
  shine: ["shone", "shining"],
  shoot: ["shot", "shooting"],
  show: ["showed", "shown", "showing"],
  shut: ["shut", "shutting"],
  sing: ["sang", "sung", "singing"],
  sink: ["sank", "sunk", "sinking"],
  sit: ["sat", "sitting"],
  sleep: ["slept", "sleeping"],
  slide: ["slid", "sliding"],
  speak: ["spoke", "spoken", "speaking"],
  spend: ["spent", "spending"],
  spin: ["spun", "spinning"],
  split: ["split", "splitting"],
  spread: ["spread", "spreading"],
  stand: ["stood", "standing"],
  steal: ["stole", "stolen", "stealing"],
  stick: ["stuck", "sticking"],
  sting: ["stung", "stinging"],
  strike: ["struck", "stricken", "striking"],
  swear: ["swore", "sworn", "swearing"],
  sweep: ["swept", "sweeping"],
  swim: ["swam", "swum", "swimming"],
  swing: ["swung", "swinging"],
  take: ["took", "taken", "taking"],
  teach: ["taught", "teaching"],
  tear: ["tore", "torn", "tearing"],
  tell: ["told", "telling"],
  think: ["thought", "thinking"],
  throw: ["threw", "thrown", "throwing"],
  understand: ["understood", "understanding"],
  wake: ["woke", "woken", "waking"],
  wear: ["wore", "worn", "wearing"],
  win: ["won", "winning"],
  wind: ["wound", "winding"],
  withdraw: ["withdrew", "withdrawn", "withdrawing"],
  write: ["wrote", "written", "writing"],
};

/**
 * Reverse lookup: maps every inflected form back to the set of base forms it belongs to.
 * Built once at module load.
 */
const _inflectedToBaseForms: Map<string, string[]> = new Map();

for (const [base, forms] of Object.entries(IRREGULAR_VERB_FORMS)) {
  for (const form of forms) {
    const lower = form.toLowerCase();
    const existing = _inflectedToBaseForms.get(lower);
    if (existing) {
      existing.push(base);
    } else {
      _inflectedToBaseForms.set(lower, [base]);
    }
  }
}

/**
 * Checks whether two tokens are irregular forms of the same verb.
 *
 * @param tokenA - First token (e.g., "wore")
 * @param tokenB - Second token (e.g., "wear")
 * @returns true if the tokens are related irregular verb forms
 */
export function isIrregularVerbMatch(tokenA: string, tokenB: string): boolean {
  const lowerA = tokenA.toLowerCase();
  const lowerB = tokenB.toLowerCase();

  if (lowerA === lowerB) return true;

  // Check if B is a base form and A is one of its inflections (or vice versa)
  const formsOfB = IRREGULAR_VERB_FORMS[lowerB];
  if (formsOfB && formsOfB.some((form) => form.toLowerCase() === lowerA)) {
    return true;
  }

  const formsOfA = IRREGULAR_VERB_FORMS[lowerA];
  if (formsOfA && formsOfA.some((form) => form.toLowerCase() === lowerB)) {
    return true;
  }

  // Check if both are inflected forms sharing a common base
  const basesOfA = _inflectedToBaseForms.get(lowerA);
  const basesOfB = _inflectedToBaseForms.get(lowerB);
  if (basesOfA && basesOfB) {
    return basesOfA.some((base) => basesOfB.includes(base));
  }

  return false;
}

/**
 * Returns every irregular form related to the given token: its inflections if
 * it is a base form, and its base forms (plus their other inflections) if it
 * is inflected. Added for the Obsidian plugin's deck index, which needs the
 * variants as lookup keys rather than a pairwise check.
 *
 * @param token - Verb form to expand (e.g., "go" or "went")
 * @returns Related forms, lowercased, excluding the token itself
 */
export function getIrregularVariants(token: string): string[] {
  const lower = token.toLowerCase();
  const variants = new Set<string>();

  for (const form of IRREGULAR_VERB_FORMS[lower] ?? []) {
    variants.add(form.toLowerCase());
  }

  for (const base of _inflectedToBaseForms.get(lower) ?? []) {
    variants.add(base);
    for (const form of IRREGULAR_VERB_FORMS[base] ?? []) {
      variants.add(form.toLowerCase());
    }
  }

  variants.delete(lower);
  return Array.from(variants);
}
