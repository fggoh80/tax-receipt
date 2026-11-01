/*
 * 马来西亚个人所得税减免分类表（YA2026，即 2026 年 1–12 月的花费，2027 年报税）
 * Kategori pelepasan cukai individu LHDN — YA2026
 *
 * ⚠ 每年财政预算案都会调整项目和上限。每年开始前请对照 LHDN 官网
 *   https://www.hasil.gov.my  (Individu → Pelepasan Cukai) 修改本文件。
 *   改了这里，AI 分类和“累计 vs 上限”会自动跟着变。
 *
 * 字段说明：
 *   id      分类代码（写进总账，不要随便改）
 *   folder  Google Drive 里的文件夹名
 *   name    显示名称
 *   cap     上限 RM（null = 无固定上限 / 非减免）
 *   group   与其他分类共享的总上限（见 RELIEF_GROUPS）
 *   covers  给 AI 看的说明：什么收据属于这一类
 */

const RELIEF_YEAR_NOTE = 'YA2026 分类表 · 最后核对：2026年11月 · 请每年对照 LHDN 官网更新';

const RELIEF_GROUPS = {
  MED: { name: '医疗总额（本人/配偶/孩子）', cap: 10000 },
  EPF_LIFE: { name: 'EPF + 人寿保险合计', cap: 7000, note: 'EPF 部分看 EA 表，不需要收据' },
};

const RELIEFS = [
  { id: 'LIFESTYLE', folder: '01 生活方式 Gaya Hidup', name: '生活方式', cap: 2500,
    covers: '本人/配偶/孩子用的书籍、报章杂志（非禁书）；电脑、手提电脑、手机、平板（新购）；家用/手机上网月费账单；非学位的技能提升课程费' },
  { id: 'SPORTS', folder: '02 运动 Sukan', name: '运动', cap: 1000,
    covers: '运动器材（球拍、球、运动鞋等，非一般服装）；运动场地租金或入场费（羽毛球场、游泳池、高尔夫等）；运动比赛报名费；健身房会员费；运动训练课程费' },
  { id: 'MED_SERIOUS', folder: '03 医疗-严重疾病与生育 Perubatan', name: '医疗：严重疾病 / 生育治疗', cap: 10000, group: 'MED',
    covers: '本人、配偶或孩子的严重疾病治疗（癌症、肾衰竭、心脏病、中风等）、生育治疗（IVF/IUI），医院或注册诊所的账单' },
  { id: 'MED_CHECKUP', folder: '04 医疗-体检与心理健康 Pemeriksaan', name: '医疗：全身体检 / 心理健康 / 检测', cap: 1000, group: 'MED',
    covers: '本人、配偶或孩子的全身体检、健康检查配套、心理健康咨询或治疗、疾病检测；自用医疗监测器材（血压计、血糖仪等）' },
  { id: 'MED_VACCINE', folder: '05 医疗-疫苗 Vaksin', name: '医疗：疫苗', cap: 1000, group: 'MED',
    covers: '本人、配偶或孩子在注册诊所/医院接种疫苗（YA2026 起涵盖所有经卫生部药监局注册的疫苗）' },
  { id: 'MED_DENTAL', folder: '06 医疗-牙科 Pergigian', name: '医疗：牙科', cap: 1000, group: 'MED',
    covers: '本人、配偶或孩子在注册牙医的检查、洗牙、补牙、拔牙等治疗（不含纯美容）' },
  { id: 'MED_CHILD_LD', folder: '07 医疗-孩子学习障碍 Kanak-kanak OKU Pembelajaran', name: '医疗：孩子学习障碍评估/干预', cap: 10000, group: 'MED',
    covers: '18岁以下孩子的学习障碍（自闭症、ADHD、唐氏综合症、学习障碍等）诊断评估、早期干预或康复治疗费用（YA2026 起子上限提高，请核对）' },
  { id: 'MED_PARENTS', folder: '08 父母医疗与护理 Perubatan Ibu Bapa', name: '父母医疗 / 护理 / 体检', cap: 8000,
    covers: '为父亲或母亲付的医疗费、看护/护理费、牙科、体检（体检子上限 RM1,000）' },
  { id: 'DISABILITY_EQUIP', folder: '09 残障辅助器材 Peralatan OKU', name: '残障辅助器材', cap: 6000,
    covers: '为已登记 OKU 的本人、配偶、孩子或父母购买的辅助器材：轮椅、助听器、义肢、特殊病床等' },
  { id: 'EDU_SELF', folder: '10 本人学费 Yuran Pendidikan', name: '本人学费 / 进修', cap: 7000,
    covers: '本人在大马认可机构修读文凭以上（法律、会计、伊斯兰金融、技术、职业、工业、科学、科技）或硕士/博士的学费；技能提升课程子上限 RM2,000' },
  { id: 'CHILDCARE', folder: '11 托儿所幼儿园 Taska Tadika', name: '托儿所 / 幼儿园学费', cap: 3000,
    covers: '孩子在已向福利局注册的托儿所（Taska）或教育部注册的幼儿园（Tadika）的学费（YA2026 起年龄范围扩大至 12 岁，请核对条件）' },
  { id: 'BREASTFEEDING', folder: '12 哺乳器材 Penyusuan', name: '哺乳器材', cap: 1000,
    covers: '母亲为 2 岁以下孩子购买的吸奶器、储奶袋/容器、冰袋等哺乳器材（每两年可申报一次）' },
  { id: 'INS_LIFE', folder: '13 人寿保险 Insurans Hayat', name: '人寿保险 / 伊斯兰保险', cap: 3000, group: 'EPF_LIFE',
    covers: '本人或配偶的人寿保险 / 家庭伊斯兰保险（Takaful）保费收据或年度保费证明' },
  { id: 'INS_EDU_MED', folder: '14 教育与医疗保险 Insurans Pendidikan Perubatan', name: '教育 / 医疗保险', cap: 4000,
    covers: '本人、配偶或孩子的医疗保险、教育保险保费收据或年度保费证明' },
  { id: 'PRS', folder: '15 私人退休计划 PRS', name: '私人退休计划 PRS / 延期年金', cap: 3000,
    covers: '向证监会认可的 PRS 基金供款证明，或延期年金保费' },
  { id: 'SSPN', folder: '16 SSPN', name: 'SSPN 教育储蓄（净存款）', cap: 8000,
    covers: 'SSPN 存款收据或年度结单（按当年存款减提款的净额计算）' },
  { id: 'EV_COMPOST', folder: '17 电动车充电与堆肥机 EV Kompos', name: '电动车充电设备 / 厨余堆肥机', cap: 2500,
    covers: '自用电动车充电设备的购买、安装、租用或订阅费；家用厨余堆肥机购买费' },
  { id: 'HOUSING_INT', folder: '18 首购屋贷款利息 Faedah Pinjaman Rumah', name: '首购屋贷款利息', cap: 7000,
    covers: '首次购买自住房屋（2025–2027 年签买卖合约）的房贷利息年度结单；屋价 RM50万以下上限 RM7,000，50–75万上限 RM5,000' },
  { id: 'DONATION', folder: '19 认可捐款 Derma', name: '认可团体捐款（扣除项）', cap: null,
    covers: '捐给政府或 LHDN 认可慈善团体/机构的捐款收据（收据上应有 LHDN 批准编号），最多可扣总收入的 10%' },
  { id: 'ZAKAT', folder: '20 天课 Zakat', name: 'Zakat / Fitrah（回扣）', cap: null,
    covers: '缴付给州宗教局的 Zakat 或 Fitrah 收据（直接扣税款）' },
  { id: 'INCOME_DOCS', folder: '00 收入与证明文件 Dokumen', name: '收入 / 身份证明文件', cap: null,
    covers: 'EA 表格、EPF 结单、PERKESO/SOCSO 结单、股息凭单、出生证、结婚证、OKU 卡等报税佐证文件（非收据）' },
  { id: 'OTHER', folder: '99 其他（非减免）Lain-lain', name: '其他（非减免，仅备查）', cap: null,
    covers: '不属于以上任何减免项目的日常花费收据（餐饮、杂货、衣服、汽油、维修等）' },
];

if (typeof module !== 'undefined') module.exports = { RELIEFS, RELIEF_GROUPS, RELIEF_YEAR_NOTE };
