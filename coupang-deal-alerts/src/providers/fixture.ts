/**
 * Deterministic synthetic provider for development, demos and tests.
 *
 * It simulates ~N popular products per category with:
 *  - a stable "usual" price per product
 *  - mild day-to-day noise (±1-2%)
 *  - some products that are perpetually "on sale" at a stable low price (should NOT alert)
 *  - occasional scheduled deep discounts (20-45%) lasting a few polls (SHOULD alert)
 *  - rank churn so products enter/leave the top list
 *
 * Time is injected (clock) so tests can fast-forward. Everything is seeded so a
 * given (categoryId, time) pair always yields the same snapshot.
 */
import type { CategorySnapshot, ProductProvider, ProviderProduct } from '../core/types.js';

export interface FixtureOptions {
  /** products simulated per category (before rank truncation) */
  productsPerCategory?: number;
  /** clock returning epoch ms; defaults to Date.now */
  now?: () => number;
  /** categories to simulate (coupang category ids). Default: the 18 standard ones */
  categoryIds?: number[];
  /** fraction of products that receive a deep discount at any given time, 0..1 */
  dealRate?: number;
  /** seed to vary the universe */
  seed?: number;
}

/** Official Partners bestcategories ids (travel categories excluded from the default demo set). */
export const DEFAULT_FIXTURE_CATEGORY_IDS = [
  1001, 1002, 1010, 1011, 1012, 1013, 1014, 1015, 1016, 1017, 1018, 1019, 1020, 1021, 1024, 1029, 1030,
];

/** Sample product titles per category so the keyword classifier has something realistic to chew on. */
const TITLE_BANK: Record<number, string[]> = {
  1001: ['여성 니트 가디건 루즈핏', '여성 와이드 데님 팬츠', '플리스 집업 자켓 여성', '여성 원피스 롱 셔츠', '여성 크로스백 미니 가방', '여성 운동화 경량', '여성 패딩 숏 점퍼', '여성 블라우스 셔츠'],
  1002: ['남성 후드티 오버핏', '남성 슬랙스 밴딩 팬츠', '남성 패딩 점퍼 경량', '남성 맨투맨 기모', '남성 벨트 소가죽', '남성 스니커즈 운동화', '남성 셔츠 옥스포드', '남성 반팔 티셔츠 3팩'],
  1030: ['신생아 바디수트 5종', '아기 내복 세트 순면', '베이비 우주복 겨울', '유아 양말 10족', '아동 패딩 점퍼 주니어', '아동 운동화 벨크로', '아동 후드티 캐릭터', '주니어 트레이닝 세트'],
  1010: ['수분 크림 대용량', '선크림 SPF50+ 톤업', '클렌징 오일 딥클렌징', '토너 패드 170매', '립틴트 벨벳', '쿠션 파운데이션 리필', '샴푸 두피 케어 1000ml', '마스크팩 30매'],
  1011: ['분유 3단계 800g 3캔', '물티슈 캡형 100매 20팩', '기저귀 팬티형 대형', '젖병 세척 세제', '이유식 큐브 소고기', '아기 물티슈 순수', '유아 치약 무불소', '아기 로션 대용량'],
  1012: ['햇반 210g 36개', '삼다수 2L 12병', '신라면 40봉', '냉동 닭가슴살 1kg 10팩', '아메리카노 스틱 100개', '올리브유 1L', '견과류 하루견과 30봉', '참치캔 150g 12개'],
  1013: ['에어프라이어 5L 대용량', '스텐 냄비 세트 3종', '코팅 프라이팬 28cm', '전기포트 1.7L', '유리 밀폐용기 10종', '칼 세트 식도', '텀블러 스텐 600ml', '커피 드립 세트'],
  1014: ['화장지 30롤 3겹', '세탁세제 액체 3L 2개', '키친타월 12롤', '섬유유연제 리필 2L', '주방세제 대용량', '멀티탭 3구 1.5m', '건전지 AA 40개', '방향제 리필'],
  1015: ['LED 스탠드 조명', '패브릭 러그 거실', '암막 커튼 2장', '수납 정리함 4단', '거울 전신 스탠드', '침구 세트 차렵이불', '베개 경추 메모리폼', '행거 스탠드 2단'],
  1016: ['LG 그램 노트북 16인치', '갤럭시 버즈 무선 이어폰', '삼성 65인치 4K TV', '다이슨 무선 청소기', 'LG 공기청정기 18평', '아이패드 태블릿 11인치', '게이밍 모니터 27인치 165Hz', '삼성 SSD 1TB NVMe'],
  1017: ['요가매트 TPE 10mm', '덤벨 세트 20kg', '캠핑 의자 릴렉스', '등산 스틱 카본', '자전거 헬멧 경량', '런닝화 쿠셔닝', '텐트 4인용 원터치', '골프 장갑 양피'],
  1018: ['블랙박스 전후방 QHD', '차량용 무선 충전 거치대', '워셔액 4L 2개', '타이어 광택제', '차량용 공기청정기', '엔진오일 5W30 4L', '차량 방향제 디퓨저', '점프스타터 휴대용'],
  1019: ['베스트셀러 소설 세트', '초등 영어 단어장', '만화 전권 세트', '자기계발 도서', '수능 기출 문제집', '아이돌 앨범 포토카드', '어린이 그림책 20권', '요리 레시피북'],
  1020: ['레고 테크닉 세트', '보드게임 파티', '퍼즐 1000피스', 'RC카 오프로드', '피규어 한정판', '슬라임 키트', '프라모델 건담', '블록 놀이 세트'],
  1021: ['A4 복사용지 2500매', '볼펜 0.5mm 12개', '노트 무선 5권', '라벨 프린터', '테이프 디스펜서', '형광펜 세트', '파일 클리어 홀더', '데스크 매트 대형'],
  1029: ['강아지 사료 8kg', '고양이 모래 벤토나이트 10kg', '강아지 배변패드 100매', '고양이 캔 24개', '반려동물 자동급식기', '강아지 간식 덴탈껌', '고양이 스크래처', '강아지 하네스'],
  1024: ['비타민D 5000IU 365정', '오메가3 알티지 180캡슐', '유산균 100억 60포', '단백질 보충제 2kg', '밀크씨슬 90정', '콜라겐 저분자 3g 60포', '마그네슘 400mg', '루테인 지아잔틴 90캡슐'],
};

/** Mulberry32 PRNG (deterministic, small). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashInt(...parts: number[]): number {
  let h = 2166136261;
  for (const p of parts) {
    h ^= p >>> 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

interface SimProduct {
  productId: string;
  name: string;
  usualPrice: number;
  /** perpetual sale: stable low price forever (should not alert) */
  alwaysOnSale: boolean;
  /** base rank tendency 1..N */
  baseRank: number;
  /** deal schedule: period (h), offset (h), duration (h), depth (fraction) */
  dealPeriodH: number;
  dealOffsetH: number;
  dealDurationH: number;
  dealDepth: number;
  isRocket: boolean;
}

const HOUR = 3600_000;

export class FixtureProvider implements ProductProvider {
  readonly name = 'fixture';
  private readonly n: number;
  private readonly now: () => number;
  private readonly categoryIds: number[];
  private readonly dealRate: number;
  private readonly seed: number;
  private readonly universe = new Map<number, SimProduct[]>();

  constructor(opts: FixtureOptions = {}) {
    this.n = opts.productsPerCategory ?? 60;
    this.now = opts.now ?? (() => Date.now());
    this.categoryIds = opts.categoryIds ?? DEFAULT_FIXTURE_CATEGORY_IDS;
    this.dealRate = opts.dealRate ?? 0.08;
    this.seed = opts.seed ?? 20240601;
  }

  get supportedCategoryIds(): number[] { return [...this.categoryIds]; }

  private buildUniverse(categoryId: number): SimProduct[] {
    const cached = this.universe.get(categoryId);
    if (cached) return cached;
    const rng = mulberry32(hashInt(this.seed, categoryId));
    const titles = TITLE_BANK[categoryId] ?? ['인기 상품'];
    const out: SimProduct[] = [];
    for (let i = 0; i < this.n; i++) {
      const base = titles[i % titles.length]!;
      const variant = Math.floor(i / titles.length);
      const name = variant === 0 ? base : `${base} ${['프리미엄', '대용량', '2개 세트', '리뉴얼', '한정판', 'NEW', '베스트', '플러스'][variant % 8]}`;
      // log-uniform price between 5,000 and 1,500,000 won, rounded to 100
      const usual = Math.round(Math.exp(Math.log(5000) + rng() * (Math.log(1_500_000) - Math.log(5000))) / 100) * 100;
      const hasDeals = rng() < 0.6; // 60% of products ever go on a real sale
      out.push({
        productId: `${categoryId}${String(i).padStart(4, '0')}`,
        name,
        usualPrice: usual,
        alwaysOnSale: rng() < 0.15,
        baseRank: i + 1,
        dealPeriodH: hasDeals ? 24 * (5 + Math.floor(rng() * 20)) : Number.POSITIVE_INFINITY, // every 5-25 days
        dealOffsetH: Math.floor(rng() * 24 * 20),
        dealDurationH: 6 + Math.floor(rng() * 42), // 6-48h
        dealDepth: 0.2 + rng() * 0.25, // 20-45%
        isRocket: rng() < 0.7,
      });
    }
    this.universe.set(categoryId, out);
    return out;
  }

  /** Price for product at time t (epoch ms). Exposed for tests. */
  priceAt(categoryId: number, index: number, t: number): { price: number; inDeal: boolean } {
    const p = this.buildUniverse(categoryId)[index]!;
    const hour = Math.floor(t / HOUR);
    const rng = mulberry32(hashInt(this.seed, categoryId, index, hour));
    let price = p.usualPrice;
    if (p.alwaysOnSale) price = Math.round(price * 0.7 / 100) * 100; // stable "always 30% off" price
    // small noise, occasionally a +/-3% wobble
    const noise = 1 + (rng() - 0.5) * 0.02;
    price = price * noise;
    let inDeal = false;
    if (Number.isFinite(p.dealPeriodH)) {
      const phase = ((hour - p.dealOffsetH) % p.dealPeriodH + p.dealPeriodH) % p.dealPeriodH;
      if (phase < p.dealDurationH) {
        inDeal = true;
        price = price * (1 - p.dealDepth);
      }
    }
    // global deal-rate knob: randomly deepen some products briefly (flash deals) on top
    if (!inDeal && rng() < this.dealRate * 0.05) {
      inDeal = true;
      price = price * (1 - (0.22 + rng() * 0.2));
    }
    return { price: Math.max(100, Math.round(price / 10) * 10), inDeal };
  }

  async fetchBestProducts(coupangCategoryId: number, limit: number): Promise<CategorySnapshot> {
    const t = this.now();
    const sims = this.buildUniverse(coupangCategoryId);
    const hour = Math.floor(t / HOUR);
    const rng = mulberry32(hashInt(this.seed, coupangCategoryId, hour, 777));
    // rank churn: jitter base rank; products in deal get a popularity boost
    const scored = sims.map((p, i) => {
      const { price, inDeal } = this.priceAt(coupangCategoryId, i, t);
      const jitter = (rng() - 0.5) * 12;
      const boost = inDeal ? -8 : 0;
      return { p, i, price, score: p.baseRank + jitter + boost };
    });
    scored.sort((a, b) => a.score - b.score);
    const products: ProviderProduct[] = scored.slice(0, Math.min(limit, scored.length)).map((s, idx) => ({
      productId: s.p.productId,
      productName: s.p.name,
      price: s.price,
      rank: idx + 1,
      productUrl: `https://www.coupang.com/vp/products/${s.p.productId}`,
      imageUrl: `https://placehold.co/256x256?text=${encodeURIComponent(s.p.name.slice(0, 6))}`,
      isRocket: s.p.isRocket,
      isFreeShipping: s.p.isRocket,
      providerCategoryName: undefined,
    }));
    return { coupangCategoryId, polledAt: t, products };
  }
}
