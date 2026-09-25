/** Dev tool: prints how the classifier buckets fixture and sample real product titles. Usage: npx tsx src/tools/classify-check.ts */
import { Classifier, loadTaxonomy } from '../core/taxonomy.js';
import { FixtureProvider } from '../providers/fixture.js';
const c = new Classifier(loadTaxonomy());
const f = new FixtureProvider({ now: () => Date.UTC(2026, 0, 1), productsPerCategory: 8 });
let etc = 0, total = 0;
for (const cat of c.categories) {
  const snap = await f.fetchBestProducts(cat.coupangCategoryId, 8);
  for (const p of snap.products) {
    const s = c.classify(cat.id, p.productName);
    total++; if (s.id.endsWith('.etc')) etc++;
    console.log(`${cat.name.padEnd(8)} | ${p.productName.padEnd(22)} -> ${s.name}`);
  }
}
const real: [string, string][] = [['appliances','듀플렉스 대용량 초음파 가습기, DP-9090UH'],['appliances','LG전자 톤프리 블루투스 이어폰 + 기프트 패키지, HBS-TFN7, 블랙'],['appliances','삼성전자 갤럭시북4 NT750XGR-A51A 15.6인치 노트북'],['appliances','노트북 파우치 13인치 맥북 케이스'],['food','동원 라이트스탠다드 참치 135g x 12캔'],['living','크리넥스 3겹 데코앤소프트 화장지 30롤 x 2팩'],['beauty','라운드랩 자작나무 수분 선크림 SPF50+ 50ml'],['pets','로얄캐닌 인도어 어덜트 고양이 사료 4kg'],['pets','로얄캐닌 미니 어덜트 강아지 사료 8kg']];
for (const [cid, name] of real) console.log('REAL', cid.padEnd(10), name, '->', c.classify(cid, name).name);
console.log(`etc rate: ${etc}/${total}`);
