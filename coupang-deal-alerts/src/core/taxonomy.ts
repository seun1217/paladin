import fs from 'node:fs';
import type { Category, Subcategory, Taxonomy } from './types.js';
import bundledTaxonomy from './taxonomy.json' with { type: 'json' };

/** Normalise text for matching: lowercase, strip whitespace and common punctuation. */
export function normalise(s: string): string {
  return s.toLowerCase().replace(/[\s\-_/·,.()\[\]+&]/g, '');
}

interface CompiledSub {
  sub: Subcategory;
  keywords: string[];
  excludes: string[];
}
interface CompiledCategory {
  category: Category;
  subs: CompiledSub[];
  etc: Subcategory;
}

/**
 * Keyword classifier: assigns a product title to exactly one subcategory within its top-level
 * category. Rules:
 *  1. Subcategories are evaluated in taxonomy order; a subcategory matches when any keyword is a
 *     substring of the normalised title and no exclude keyword matches.
 *  2. Among matching subcategories the one whose matched keyword is LONGEST wins (more specific);
 *     ties go to the earlier subcategory in taxonomy order.
 *  3. If nothing matches, the category's catch-all ("<id>.etc") is returned.
 */
export class Classifier {
  private readonly byId = new Map<string, CompiledCategory>();
  private readonly byCoupangId = new Map<number, CompiledCategory>();
  private readonly subById = new Map<string, { sub: Subcategory; category: Category }>();

  constructor(public readonly taxonomy: Taxonomy) {
    for (const c of taxonomy.categories) {
      let etc = c.subcategories.find((s) => s.id === `${c.id}.etc`);
      if (!etc) {
        etc = { id: `${c.id}.etc`, name: '기타', keywords: [] };
        c.subcategories.push(etc);
      }
      const compiled: CompiledCategory = {
        category: c,
        subs: c.subcategories
          .filter((s) => s.id !== etc!.id)
          .map((s) => ({ sub: s, keywords: s.keywords.map(normalise).filter(Boolean), excludes: (s.excludeKeywords ?? []).map(normalise).filter(Boolean) })),
        etc,
      };
      this.byId.set(c.id, compiled);
      this.byCoupangId.set(c.coupangCategoryId, compiled);
      for (const s of c.subcategories) this.subById.set(s.id, { sub: s, category: c });
    }
  }

  get categories(): Category[] { return this.taxonomy.categories; }
  get coupangCategoryIds(): number[] { return this.taxonomy.categories.map((c) => c.coupangCategoryId); }

  categoryForCoupangId(id: number): Category | null { return this.byCoupangId.get(id)?.category ?? null; }
  category(id: string): Category | null { return this.byId.get(id)?.category ?? null; }
  subcategory(id: string): { sub: Subcategory; category: Category } | null { return this.subById.get(id) ?? null; }
  subcategoryName(id: string): string | undefined { return this.subById.get(id)?.sub.name; }
  hasSubcategory(id: string): boolean { return this.subById.has(id); }
  allSubcategoryIds(): string[] { return [...this.subById.keys()]; }

  classify(categoryId: string, productName: string, providerCategoryName?: string): Subcategory {
    const c = this.byId.get(categoryId);
    if (!c) throw new Error(`unknown category ${categoryId}`);
    const text = normalise(`${productName} ${providerCategoryName ?? ''}`);
    let best: { sub: Subcategory; len: number } | null = null;
    for (const cs of c.subs) {
      if (cs.excludes.some((x) => text.includes(x))) continue;
      let len = 0;
      for (const k of cs.keywords) if (text.includes(k) && k.length > len) len = k.length;
      if (len > 0 && (!best || len > best.len)) best = { sub: cs.sub, len };
    }
    return best ? best.sub : c.etc;
  }
}

export function validateTaxonomy(t: Taxonomy): string[] {
  const errors: string[] = [];
  const catIds = new Set<string>();
  const cIds = new Set<number>();
  const subIds = new Set<string>();
  for (const c of t.categories) {
    if (!/^[a-z][a-z0-9_]*$/.test(c.id)) errors.push(`bad category id ${c.id}`);
    if (catIds.has(c.id)) errors.push(`duplicate category id ${c.id}`);
    catIds.add(c.id);
    if (cIds.has(c.coupangCategoryId)) errors.push(`duplicate coupang id ${c.coupangCategoryId}`);
    cIds.add(c.coupangCategoryId);
    if (!c.name) errors.push(`category ${c.id} has no name`);
    for (const s of c.subcategories) {
      if (!s.id.startsWith(`${c.id}.`)) errors.push(`subcategory ${s.id} must be prefixed with ${c.id}.`);
      if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(s.id)) errors.push(`bad subcategory id ${s.id}`);
      if (subIds.has(s.id)) errors.push(`duplicate subcategory id ${s.id}`);
      subIds.add(s.id);
      if (!s.name) errors.push(`subcategory ${s.id} has no name`);
      if (!Array.isArray(s.keywords)) errors.push(`subcategory ${s.id} keywords must be an array`);
    }
  }
  return errors;
}

/**
 * Load the taxonomy: the bundled JSON by default, or a custom file (TAXONOMY_PATH) so operators can
 * tune keywords without rebuilding. Returns a deep copy so callers may mutate safely.
 */
export function loadTaxonomy(file: string | undefined = process.env.TAXONOMY_PATH || undefined): Taxonomy {
  const raw = (file ? JSON.parse(fs.readFileSync(file, 'utf8')) : structuredClone(bundledTaxonomy)) as Taxonomy;
  const errors = validateTaxonomy(raw);
  if (errors.length) throw new Error(`invalid taxonomy: ${errors.join('; ')}`);
  return raw;
}
