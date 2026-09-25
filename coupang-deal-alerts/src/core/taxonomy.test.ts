import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Classifier, loadTaxonomy, normalise, validateTaxonomy } from './taxonomy.js';

test('normalise strips spaces/punctuation and lowercases', () => {
  assert.equal(normalise('LG 그램 노트북 16인치 (2025)'), 'lg그램노트북16인치2025');
});

test('classifier picks longest keyword, honours excludes, falls back to etc', () => {
  const c = new Classifier({ categories: [{ id: 'a', name: 'A', coupangCategoryId: 1016, subcategories: [
    { id: 'a.laptop', name: '노트북', keywords: ['노트북', '맥북'], excludeKeywords: ['가방', '거치대'] },
    { id: 'a.bag', name: '노트북 가방', keywords: ['노트북 가방', '가방'] },
    { id: 'a.acc', name: '거치대', keywords: ['거치대'] },
  ] }] });
  assert.equal(c.classify('a', 'LG 그램 노트북 16').id, 'a.laptop');
  assert.equal(c.classify('a', '노트북 가방 15인치').id, 'a.bag', 'exclude removes laptop, longest match wins');
  assert.equal(c.classify('a', '알루미늄 노트북 거치대').id, 'a.acc');
  assert.equal(c.classify('a', '완전히 다른 상품').id, 'a.etc');
  assert.equal(c.subcategoryName('a.etc'), '기타');
  assert.equal(c.categoryForCoupangId(1016)!.id, 'a');
  assert.equal(c.categoryForCoupangId(9999), null);
  assert.throws(() => c.classify('zzz', 'x'));
});

test('bundled taxonomy is valid and covers all its categories with an etc bucket', () => {
  const t = loadTaxonomy();
  assert.deepEqual(validateTaxonomy(t), []);
  const c = new Classifier(t);
  for (const cat of t.categories) {
    assert.ok(cat.subcategories.length >= 2, `${cat.id} has too few subcategories`);
    assert.ok(c.hasSubcategory(`${cat.id}.etc`));
  }
  const ids = new Set(c.coupangCategoryIds);
  assert.equal(ids.size, t.categories.length);
});

test('validateTaxonomy reports structural problems', () => {
  const errs = validateTaxonomy({ categories: [
    { id: 'Bad', name: '', coupangCategoryId: 1, subcategories: [{ id: 'other.x', name: 'x', keywords: [] }, { id: 'other.x', name: 'x', keywords: [] }] },
    { id: 'ok', name: 'ok', coupangCategoryId: 1, subcategories: [] },
  ] });
  assert.ok(errs.some((e) => e.includes('bad category id Bad')));
  assert.ok(errs.some((e) => e.includes('no name')));
  assert.ok(errs.some((e) => e.includes('must be prefixed')));
  assert.ok(errs.some((e) => e.includes('duplicate subcategory id')));
  assert.ok(errs.some((e) => e.includes('duplicate coupang id 1')));
});
