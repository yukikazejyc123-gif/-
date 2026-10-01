(() => {
  'use strict';
  const C = LedgerCore;
  const root = document.getElementById('little-ledger-preview');
  const phone = root.querySelector('.ll-phone');
  const store = globalThis.ledgerStorage || {data: null, today: '2026-09-30', save: () => true};
  const sample = {version: 1, currency: 'JPY', transactions: [
    {id: 1, type: 'expense', category: '餐饮', amount: 980, note: '定食午饭', date: '2026-09-30'},
    {id: 2, type: 'expense', category: '餐饮', amount: 480, note: '一杯拿铁', date: '2026-09-30'},
    {id: 3, type: 'expense', category: '交通', amount: 320, note: '电车车票', date: '2026-09-30'},
    {id: 4, type: 'expense', category: '学习', amount: 1650, note: '一本新书', date: '2026-09-28'},
    {id: 5, type: 'expense', category: '购物', amount: 4280, note: '生活用品', date: '2026-09-26'},
    {id: 6, type: 'expense', category: '居住', amount: 68000, note: '本月房租', date: '2026-09-05'},
    {id: 7, type: 'income', category: '工资', amount: 220000, note: '九月工资', date: '2026-09-05'},
    {id: 8, type: 'expense', category: '餐饮', amount: 12800, note: '一月的日常餐饮', date: '2026-01-20'},
    {id: 9, type: 'income', category: '工资', amount: 210000, note: '一月工资', date: '2026-01-05'},
    {id: 10, type: 'expense', category: '购物', amount: 5800, note: '二月的生活用品', date: '2026-02-12'},
    {id: 11, type: 'expense', category: '娱乐', amount: 48000, note: '六月的旅行', date: '2026-06-18'},
    {id: 12, type: 'expense', category: '居住', amount: 76000, note: '八月的房租及杂费', date: '2026-08-05'},
    {id: 13, type: 'income', category: '工资', amount: 220000, note: '八月工资', date: '2026-08-05'}
  ], budgets: {'2026-09': {餐饮: 30000, 购物: 5000}}};
  let collection = C.normalizeCollection(store.data || sample), model;
  function bindBook() {model = C.activeBook(collection).data; Object.assign(model.design, collection.preferences);}
  function commitActive() {C.activeBook(collection).data = model; for (const key of ['language', 'palette', 'radius', 'mascot', 'animations']) collection.preferences[key] = model.design[key];}
  bindBook();
  let picker = null, pickerReturnFocus = '', editingBookId = null, bookNameDraft = '';
  let today = C.validDate(store.today) ? store.today : '2026-09-30';
  let currentMonth = today.slice(0, 7), selectedMonth = currentMonth, selectedDay = null;
  let screen = 'home', history = [], viewYear = Number(today.slice(0, 4)), monthOrigin = 'home';
  let draft = {}, editId = null, detailId = null, categoryType = 'expense', categoryDraft = null;
  let budgetCategory = '餐饮', budgetDraft = '', filterCategory = null, statType = 'expense', trendDay = null;
  let query = '', error = '', toast = '', modal = null, pendingBackup = null, undoModel = null, busy = false, toastTimer, listLimit = 80;
  let lastRenderedScreen = null, lastHomeDate = null, dateAnimationTimer, koalaReaction = 0, koalaTimer, koalaBlinkTimer, rateRequest = null, rateSequence = 0;
  let rebaseDraft = null, rebaseRequest = null, rebaseTimer;
  const e = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const money = (value, currency = model.currency) => C.formatAmount(value, currency);
  const currencySymbol = (currency = model.currency) => C.currencyInfo(currency).symbol;
  const amountInput = (value, currency = model.currency) => {const digits = C.currencyInfo(currency).digits; const raw = String(value).padStart(digits + 1, '0'); return digits ? raw.slice(0, -digits) + '.' + raw.slice(-digits) : raw;};
  const converted = record => record.convertedAmount ?? record.amount;
  const currencyName = code => {const info = C.currencyInfo(code); return model.design.language === 'en' ? info.nameEn : model.design.language === 'ko' ? info.nameKo || info.nameZh : model.design.language === 'ja' ? info.nameJa : info.nameZh;};
  const currencyLabel = code => `${code} · ${currencyName(code)}`;
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const softIcons = new Map([
    ...['utensils', 'coffee', 'train-front', 'shopping-bag'].map((glyph, index) => [glyph, ['soft', index, 2]]),
    ...['house', 'headphones', 'heart', 'book-open', 'ellipsis', 'wallet', 'gift', 'shopping-cart', 'paw-print'].map((glyph, index) => [glyph, ['life', index, 3]]),
    ...['plane', 'smartphone', 'shirt', 'leaf', 'briefcase-business', 'bike', 'music', 'cake', 'umbrella'].map((glyph, index) => [glyph, ['hobbies', index, 3]]),
    ...['coins', 'ticket', 'flower-2'].map((glyph, index) => [glyph, ['money', index, 2]])
  ]);
  const categoryIcon = (glyph, cls = '', style = '', categoryColor = 'sage') => {const sprite = softIcons.get(glyph); return `<span class="ll-category-icon ${cls}" data-glyph="${e(glyph)}" data-color="${e(categoryColor)}" ${style ? `style="${e(style)}"` : ''} aria-hidden="true">${sprite ? `<span class="ll-soft-icon" data-soft-icon="${e(glyph)}" data-sprite="${sprite[0]}" style="background-position:${sprite[1] % sprite[2] / (sprite[2] - 1) * 100}% ${Math.floor(sprite[1] / sprite[2]) / (sprite[2] - 1) * 100}%"></span>` : icon(glyph)}</span>`;};
  const iconNames = {
    utensils: ['餐饮', '食事', '식비'], 'shopping-bag': ['购物', '買い物', '쇼핑'], 'train-front': ['交通', '交通', '교통'], house: ['居住', '住まい', '주거'], headphones: ['娱乐', '娯楽', '여가'], heart: ['健康', '健康', '건강'], 'book-open': ['学习', '学習', '학습'], ellipsis: ['其他', 'その他', '기타'], wallet: ['钱包', 'お財布', '지갑'], gift: ['礼物', 'ギフト', '선물'], coffee: ['咖啡', 'コーヒー', '커피'], 'shopping-cart': ['超市', 'スーパー', '마트'], 'paw-print': ['宠物', 'ペット', '반려동물'], plane: ['旅行', '旅行', '여행'], smartphone: ['手机', 'スマートフォン', '휴대폰'], shirt: ['服饰', '衣服', '의류'], leaf: ['自然', '自然', '자연'], 'briefcase-business': ['工作', '仕事', '직장'], bike: ['自行车', '自転車', '자전거'], music: ['音乐', '音楽', '음악'], cake: ['蛋糕', 'ケーキ', '케이크'], umbrella: ['雨伞', '傘', '우산'], coins: ['零钱', '小銭', '동전'], ticket: ['票券', 'チケット', '티켓'], 'flower-2': ['花朵', 'お花', '꽃']
  };
  const iconLabel = glyph => model.design.language === 'en' ? t(iconNames[glyph]?.[0] || glyph) : iconNames[glyph]?.[{zh: 0, ja: 1, ko: 2}[model.design.language]] || glyph;
  const dictionary = {
    '小小账本': 'こつこつ家計簿', '每一笔，都是生活': 'ひとつひとつ、暮らしの記録', '账单': '明細', '统计': '集計', '预算': '予算', '我的': '設定', '记一笔': '記録', '日本語': '日本語', '中文': '中文', '显示更多': 'さらに表示',
    '点点考拉': 'コアラをタップ', '点我一下': 'タップしてね', '轻轻蹦一下': 'ぴょんっ', '歪歪头': 'こてんっ', '你好呀': 'こんにちは', '这周': 'この週',
    '主货币': '基準通貨', '选择货币': '通貨を選ぶ', '这笔的货币': 'この記録の通貨', '主货币用于统计和预算，每一笔都可以选择不同货币。': '集計と予算は基準通貨に換算します。記録ごとに通貨を選べます。', '开始记账前可以更换主货币。': '記録を始める前に基準通貨を変更できます。', '已有账目或预算，主货币暂不能更换。': '記録や予算があるため、基準通貨は変更できません。', '主货币已更新': '基準通貨を変更しました', '汇率': '換算レート', '更新汇率': 'レートを更新', '正在获取汇率': 'レートを取得中', '最近缓存': '前回のレート', '手动汇率': '手入力のレート', '原记录汇率': '記録時のレート', '最新汇率': '最新のレート', '暂时无法联网，可使用缓存或手动输入汇率。': '接続できません。保存済みレートか手入力を使えます。', '请输入有效汇率。': '有効な換算レートを入力してください。', '请输入大于 0 的有效金额。': '0より大きい有効な金額を入力してください。', '金额或换算结果超出范围。': '金額または換算結果が上限を超えています。', '折合': '換算後', '报价日期': 'レートの日付', '保存时会固定这笔汇率，不随以后的报价变化。': '保存したレートは、その後の相場で変わりません。', '轻快动画': '軽やかなアニメーション', '开启': 'オン', '关闭': 'オフ', '动画已更新': 'アニメーション設定を変更しました', '背景色': '背景色', '鼠尾草绿': 'セージ', '蜜桃粉': 'ピーチ', '奶油黄': 'サンド', '淡紫色': 'ライラック', '天空蓝': 'スカイ', '分类预览': 'カテゴリのプレビュー',
    '今天': '今日', '本月': '今月', '全部': 'すべて', '本月支出': '今月の支出', '当月支出': 'この月の支出', '本月收入': '今月の収入', '当月收入': 'この月の収入', '本月结余': '今月の収支', '当月结余': 'この月の収支',
    '日元': '日本円', '现金': '現金', '收入': '収入', '支出': '支出', '年度账单': '年間の収支', '按日期查看': '日付で見る', '分类预算': 'カテゴリ別予算', '查看全部': 'すべて見る', '账单明细': '記録の明細', '笔': '件', '本月全部': '月の全記録',
    '给生活留一点余地': '暮らしに、少し余裕を', '还没有设置预算': '予算はまだ設定されていません', '先为常用分类设一个小目标吧。': 'よく使うカテゴリから始めましょう。', '设置预算': '予算を設定', '添加分类预算': 'カテゴリ予算を追加', '预算还剩': '残り', '已超支': '超過', '接近预算': '残りわずか', '预算充足': '予算内', '已花': '支出', '限额': '予算額', '调整预算': '予算を変更',
    '这里还空着，生活慢慢记。': 'ここはまだ空白。少しずつ記録しましょう。', '没有符合条件的账目': '条件に合う記録はありません', '这天还没有账目': 'この日の記録はまだありません', '这个月还没有账目': 'この月の記録はまだありません', '返回': '戻る', '日期': '日付', '备注': 'メモ', '选填': '任意', '保存': '保存', '保存修改': '変更を保存', '保存，再记一笔': '保存して、もう一件', '清空': 'クリア', '金额': '金額',
    '修改账目': '記録を編集', '分类': 'カテゴリ', '管理': '管理', '未来日期': '未来の日付', '这笔会计入所选月份的收支和预算。': '選んだ月の収支と予算に反映します。', '已保存': '保存しました', '已修改': '更新しました', '已删除': '削除しました', '预算已更新': '予算を更新しました', '分类已更新': 'カテゴリを更新しました',
    '请输入大于 0 的整数日元金额。': '1円以上の整数を入力してください。', '算式有误，或金额超出范围。': '式を確認してください。金額の上限も確認してください。', '请选择有效日期。': '有効な日付を選択してください。', '保存失败，请重试。': '保存できませんでした。もう一度お試しください。', '无法读取已有账目，请先保留原始数据。': '記録を読み込めません。元のデータを保管してください。',
    '明细': '詳細', '编辑': '編集', '删除': '削除', '取消': 'キャンセル', '确认删除': '削除する', '删除这笔账目？': 'この記録を削除しますか？', '删除后将同步更新统计与预算。': '集計と予算にも反映されます。', '没有备注': 'メモなし', '支付方式': '支払方法', '收支类型': '種類', '日常记录': '暮らしの記録', '例如：便利店午饭': '例：コンビニのお昼ごはん',
    '钱都花在哪了': '何に使ったかな', '最多支出': '支出の多いカテゴリ', '最多收入': '収入の多いカテゴリ', '分类占比': 'カテゴリ別の割合', '每日趋势': '日ごとの推移', '收支趋势': '収支の推移', '这段时间还没有记录': 'この期間の記録はまだありません', '全年支出': '年間の支出', '全年收入': '年間の収入', '全年结余': '年間の収支', '每月收支': '月ごとの収支', '选择月份': '月を選ぶ', '上一月': '前月', '下一月': '翌月', '上一年': '前年', '下一年': '翌年', '年份': '年', '今年': '今年', '周一': '月', '周二': '火', '周三': '水', '周四': '木', '周五': '金', '周六': '土', '周日': '日',
    '设置这个月的分类预算': 'この月のカテゴリ予算', '预算金额': '予算額', '只计算所选月份、这个分类的支出。': '選んだ月・カテゴリの支出を集計します。', '取消这项预算': 'この予算を解除', '沿用上月预算': '前月の予算をコピー', '用上月设置替换本月预算？': '前月の設定で、この月の予算を置き換えますか？', '其他月份的预算不受影响。': 'ほかの月の予算は変わりません。', '确认替换': '置き換える',
    '我的账本': '私の家計簿', '慢慢记录，好好生活。': '少しずつ記録、日々を大切に。', '数据保存在这部手机里': 'データはこの端末に保存', '账本设置': '家計簿の設定', '界面语言': '表示言語', '自定义分类': 'カテゴリを管理', '备份与导出': 'バックアップ・書き出し', '保存完整备份': '完全バックアップを保存', '账目、预算、分类和设置': '記録・予算・カテゴリ・設定', '从文件恢复': 'ファイルから復元', '选择以前保存的完整备份': '保存したバックアップを選択', '导出 CSV 明细': 'CSVで明細を書き出す', '在电脑上查看全部账目': '全記録をパソコンで確認', '撤销上次恢复': '前回の復元を取り消す', '回到恢复前的账本': '復元前の家計簿に戻す',
    '新增分类': 'カテゴリを追加', '编辑分类': 'カテゴリを編集', '中文名称': '中国語の名前', '日文名称': '日本語の名前', '日文留空时显示中文名称。': '日本語が空欄の場合は中国語で表示します。', '图标': 'アイコン', '显示': '表示', '隐藏': '非表示', '已隐藏': '非表示', '上移': '上へ', '下移': '下へ', '隐藏后，历史账目与预算仍会保留。': '非表示でも過去の記録と予算は残ります。', '请填写分类名称。': 'カテゴリ名を入力してください。', '同类型中已有这个分类名称。': '同じ種類に同名のカテゴリがあります。', '至少保留一个可用分类。': '少なくとも一つのカテゴリを表示してください。',
    '恢复备份': 'バックアップを復元', '请先确认备份内容': '内容を確認してください', '账目数量': '記録件数', '日期范围': '日付の範囲', '预算月份': '予算の月数', '备份时间': '保存日時', '货币': '通貨', '恢复这份备份': 'このバックアップを復元', '替换当前账本？': '現在の家計簿を置き換えますか？', '恢复前会保留全部账本副本，可撤销这次恢复。': '現在の家計簿を先に保存し、復元後に元へ戻せます。', '原始文件会保留副本。': '元のファイルのコピーを保存します。', '恢复已完成': '復元しました', '已撤销恢复': '復元を取り消しました', '文件不是有效的小小账本备份。': '有効な家計簿バックアップではありません。', '备份版本暂不支持。': 'このバックアップのバージョンは未対応です。', '无法保存或读取文件，请重试。': 'ファイルを保存・読み込みできませんでした。', '文件已保存': 'ファイルを保存しました', '正在打开文件选择器': 'ファイル選択画面を開きます', '备份文件包含你的账目，请妥善保管。': '記録を含むファイルです。大切に保管してください。', '明细导出不包含预算和分类设置。': 'CSVには予算やカテゴリ設定は含まれません。', '搜索账目': '記録を検索', '搜索分类、备注或金额': 'カテゴリ・メモ・金額で検索', '考拉': 'コアラ', '关闭': '閉じる', '开始记账': '記録を始める'
  };
  dictionary['停用'] = 'オフ';
  dictionary['仅联网获取汇率，账目仍保存在手机里。'] = '通信はレートの取得だけ。記録はこの端末に保存します。';
  dictionary['请输入大于 0 的整数金额。'] = '1以上の整数を入力してください。';
  Object.assign(dictionary, {
    '韩文名称': '韓国語の名前', '其他语言留空时显示中文名称。': 'ほかの言語が空欄の場合は中国語で表示します。', '选择语言': '言語を選ぶ',
    '更改主货币': '基準通貨を変更', '账目和预算将一起换算，原币金额和旧换算记录会保留。': '記録と予算を一緒に換算します。元の通貨の金額と以前の換算記録は残ります。',
    '确认换算': '換算して変更', '换算预览': '換算のプレビュー', '当前主货币': '現在の基準通貨', '新的主货币': '新しい基準通貨', '全部支出': '全記録の支出', '全部收入': '全記録の収入',
    '换算预算': '換算する予算', '项': '件', '所需汇率': '必要なレート', '缺少有效汇率，请更新或手动填写。': '有効なレートが必要です。更新するか手入力してください。',
    '使用已保留的换算记录': '保存済みの換算記録を使います', '尚无账目或预算，可直接更换。': '記録も予算もないため、そのまま変更できます。',
    '新主货币下的金额会按以下汇率固定，已存在的换算记录会直接复用。': '以下のレートで新しい金額を固定します。保存済みの換算記録はそのまま再利用します。',
    '旧主货币下的换算记录保留，切回时可以复用。': '以前の基準通貨の換算記録は残り、戻すときに再利用できます。',
    '预算换算后小于最小金额，请调整汇率或预算。': '換算後の予算が最小単位未満です。レートか予算を調整してください。', '换算结果超出范围，请调整汇率。': '換算結果が上限を超えています。レートを調整してください。',
    '自动获取全部汇率': 'すべてのレートを取得', '换算记录': '換算履歴', '演示汇率': 'プレビュー用レート', '无需报价': 'レート取得は不要です'
  });
  const korean = {
    '小小账本': '차곡차곡 가계부', '每一笔，都是生活': '한 줄씩 담는 나의 일상', '账单': '내역', '统计': '통계', '预算': '예산', '我的': '설정', '记一笔': '기록', '日本語': '日本語', '中文': '中文', '显示更多': '더 보기',
    '点点考拉': '코알라를 눌러 주세요', '点我一下': '나를 눌러 봐요', '轻轻蹦一下': '폴짝!', '歪歪头': '갸우뚱', '你好呀': '안녕하세요', '这周': '이번 주',
    '主货币': '기준 통화', '选择货币': '통화 선택', '这笔的货币': '이 기록의 통화', '主货币用于统计和预算，每一笔都可以选择不同货币。': '통계와 예산은 기준 통화로 계산해요. 기록마다 통화를 선택할 수 있어요.',
    '开始记账前可以更换主货币。': '기록을 시작하기 전에 기준 통화를 바꿀 수 있어요.', '已有账目或预算，主货币暂不能更换。': '기록이나 예산이 있어 기준 통화를 바꿀 수 없어요.', '主货币已更新': '기준 통화를 변경했어요',
    '汇率': '환율', '更新汇率': '환율 갱신', '正在获取汇率': '환율을 가져오는 중', '最近缓存': '저장된 환율', '手动汇率': '직접 입력한 환율', '原记录汇率': '기록 당시 환율', '最新汇率': '최신 환율',
    '暂时无法联网，可使用缓存或手动输入汇率。': '연결할 수 없어요. 저장된 환율을 쓰거나 직접 입력해 주세요.', '请输入有效汇率。': '올바른 환율을 입력해 주세요.', '请输入大于 0 的有效金额。': '0보다 큰 금액을 입력해 주세요.',
    '金额或换算结果超出范围。': '금액 또는 환산 결과가 한도를 초과했어요.', '折合': '환산', '报价日期': '환율 기준일', '保存时会固定这笔汇率，不随以后的报价变化。': '저장하면 이 기록의 환율은 고정돼요. 이후 환율에 따라 바뀌지 않아요.',
    '轻快动画': '가벼운 애니메이션', '开启': '켜짐', '关闭': '닫기', '停用': '꺼짐', '动画已更新': '애니메이션 설정을 변경했어요', '背景色': '배경색', '鼠尾草绿': '세이지', '蜜桃粉': '피치', '奶油黄': '크림', '淡紫色': '라일락', '天空蓝': '하늘색', '分类预览': '분류 미리보기',
    '今天': '오늘', '本月': '이번 달', '全部': '전체', '本月支出': '이번 달 지출', '当月支出': '선택한 달 지출', '本月收入': '이번 달 수입', '当月收入': '선택한 달 수입', '本月结余': '이번 달 잔액', '当月结余': '선택한 달 잔액',
    '日元': '일본 엔', '现金': '현금', '收入': '수입', '支出': '지출', '年度账单': '연간 내역', '按日期查看': '날짜별 보기', '分类预算': '분류별 예산', '查看全部': '전체 보기', '账单明细': '상세 내역', '笔': '건', '本月全部': '이번 달 전체',
    '给生活留一点余地': '일상에 작은 여유를', '还没有设置预算': '아직 예산이 없어요', '先为常用分类设一个小目标吧。': '자주 쓰는 분류부터 작은 목표를 세워 봐요.', '设置预算': '예산 설정', '添加分类预算': '분류 예산 추가', '预算还剩': '남은 예산', '已超支': '예산 초과', '接近预算': '예산에 가까워요', '预算充足': '예산에 여유가 있어요', '已花': '사용액', '限额': '예산액', '调整预算': '예산 수정',
    '这里还空着，生活慢慢记。': '아직 비어 있어요. 차근차근 기록해 봐요.', '没有符合条件的账目': '조건에 맞는 기록이 없어요', '这天还没有账目': '이 날짜에는 기록이 없어요', '这个月还没有账目': '이 달에는 기록이 없어요', '返回': '뒤로', '日期': '날짜', '备注': '메모', '选填': '선택 사항', '保存': '저장', '保存修改': '수정 저장', '保存，再记一笔': '저장하고 계속 기록', '清空': '지우기', '金额': '금액',
    '修改账目': '기록 수정', '分类': '분류', '管理': '관리', '未来日期': '미래 날짜', '这笔会计入所选月份的收支和预算。': '선택한 달의 수입·지출과 예산에 반영돼요.', '已保存': '저장했어요', '已修改': '수정했어요', '已删除': '삭제했어요', '预算已更新': '예산을 변경했어요', '分类已更新': '분류를 변경했어요',
    '请输入大于 0 的整数日元金额。': '1엔 이상의 정수를 입력해 주세요.', '请输入大于 0 的整数金额。': '1 이상의 정수를 입력해 주세요.', '算式有误，或金额超出范围。': '계산식 또는 금액 한도를 확인해 주세요.', '请选择有效日期。': '올바른 날짜를 선택해 주세요.', '保存失败，请重试。': '저장하지 못했어요. 다시 시도해 주세요.', '无法读取已有账目，请先保留原始数据。': '기록을 읽을 수 없어요. 먼저 원본 데이터를 보관해 주세요.',
    '明细': '상세', '编辑': '수정', '删除': '삭제', '取消': '취소', '确认删除': '삭제하기', '删除这笔账目？': '이 기록을 삭제할까요?', '删除后将同步更新统计与预算。': '삭제하면 통계와 예산에도 반영돼요.', '没有备注': '메모 없음', '支付方式': '결제 방법', '收支类型': '기록 종류', '日常记录': '일상의 기록', '例如：便利店午饭': '예: 편의점 점심',
    '钱都花在哪了': '어디에 썼을까요', '最多支出': '지출이 가장 큰 분류', '最多收入': '수입이 가장 큰 분류', '分类占比': '분류별 비율', '每日趋势': '일별 추이', '收支趋势': '수입·지출 추이', '这段时间还没有记录': '이 기간에는 기록이 없어요', '全年支出': '연간 지출', '全年收入': '연간 수입', '全年结余': '연간 잔액', '每月收支': '월별 수입·지출', '选择月份': '월 선택', '上一月': '이전 달', '下一月': '다음 달', '上一年': '이전 해', '下一年': '다음 해', '年份': '연도', '今年': '올해', '周一': '월', '周二': '화', '周三': '수', '周四': '목', '周五': '금', '周六': '토', '周日': '일',
    '设置这个月的分类预算': '이 달의 분류별 예산을 설정해요', '预算金额': '예산 금액', '只计算所选月份、这个分类的支出。': '선택한 달과 분류의 지출만 계산해요.', '取消这项预算': '이 예산 삭제', '沿用上月预算': '지난달 예산 복사', '用上月设置替换本月预算？': '지난달 예산으로 이번 달 예산을 바꿀까요?', '其他月份的预算不受影响。': '다른 달의 예산에는 영향이 없어요.', '确认替换': '바꾸기',
    '我的账本': '나의 가계부', '慢慢记录，好好生活。': '차근차근 기록하고, 일상을 소중하게.', '数据保存在这部手机里': '데이터는 이 휴대폰에 저장돼요', '账本设置': '가계부 설정', '界面语言': '화면 언어', '自定义分类': '분류 관리', '备份与导出': '백업·내보내기', '保存完整备份': '전체 백업 저장', '账目、预算、分类和设置': '기록·예산·분류·설정', '从文件恢复': '파일에서 복원', '选择以前保存的完整备份': '저장한 전체 백업을 선택해요', '导出 CSV 明细': 'CSV 내역 내보내기', '在电脑上查看全部账目': '컴퓨터에서 전체 기록 보기', '撤销上次恢复': '이전 복원 되돌리기', '回到恢复前的账本': '복원 전 가계부로 돌아가요',
    '新增分类': '분류 추가', '编辑分类': '분류 수정', '中文名称': '중국어 이름', '日文名称': '일본어 이름', '韩文名称': '한국어 이름', '日文留空时显示中文名称。': '일본어 이름이 없으면 중국어 이름을 표시해요.', '其他语言留空时显示中文名称。': '다른 언어 이름이 없으면 중국어 이름을 표시해요.', '图标': '아이콘', '显示': '표시', '隐藏': '숨기기', '已隐藏': '숨김', '上移': '위로', '下移': '아래로', '隐藏后，历史账目与预算仍会保留。': '숨겨도 이전 기록과 예산은 보존돼요.', '请填写分类名称。': '분류 이름을 입력해 주세요.', '同类型中已有这个分类名称。': '같은 종류에 동일한 분류 이름이 있어요.', '至少保留一个可用分类。': '최소 한 개의 분류를 표시해야 해요.',
    '恢复备份': '백업 복원', '请先确认备份内容': '백업 내용을 확인해 주세요', '账目数量': '기록 수', '日期范围': '날짜 범위', '预算月份': '예산이 있는 달', '备份时间': '백업 시간', '货币': '통화', '恢复这份备份': '이 백업 복원', '替换当前账本？': '현재 가계부를 바꿀까요?', '恢复前会保留全部账本副本，可撤销这次恢复。': '현재 가계부의 사본을 먼저 저장하므로 복원을 되돌릴 수 있어요.', '原始文件会保留副本。': '원본 파일의 사본을 보관해요.', '恢复已完成': '복원했어요', '已撤销恢复': '복원을 되돌렸어요', '文件不是有效的小小账本备份。': '올바른 가계부 백업 파일이 아니에요.', '备份版本暂不支持。': '이 백업 버전은 아직 지원하지 않아요.', '无法保存或读取文件，请重试。': '파일을 저장하거나 읽지 못했어요. 다시 시도해 주세요.', '文件已保存': '파일을 저장했어요', '正在打开文件选择器': '파일 선택창을 여는 중', '备份文件包含你的账目，请妥善保管。': '백업에 개인 기록이 포함돼요. 잘 보관해 주세요.', '明细导出不包含预算和分类设置。': 'CSV에는 예산과 분류 설정이 포함되지 않아요.', '搜索账目': '기록 검색', '搜索分类、备注或金额': '분류·메모·금액 검색', '考拉': '코알라', '开始记账': '기록 시작',
    '仅联网获取汇率，账目仍保存在手机里。': '환율을 가져올 때만 인터넷을 사용해요. 기록은 휴대폰에 저장돼요.', '选择语言': '언어 선택',
    '更改主货币': '기준 통화 변경', '账目和预算将一起换算，原币金额和旧换算记录会保留。': '기록과 예산을 함께 환산해요. 원래 통화의 금액과 이전 환산 기록은 보존돼요.', '确认换算': '환산하여 변경', '换算预览': '환산 미리보기', '当前主货币': '현재 기준 통화', '新的主货币': '새 기준 통화', '全部支出': '전체 지출', '全部收入': '전체 수입', '换算预算': '환산할 예산', '项': '개', '所需汇率': '필요한 환율', '缺少有效汇率，请更新或手动填写。': '유효한 환율이 필요해요. 갱신하거나 직접 입력해 주세요.', '使用已保留的换算记录': '보존된 환산 기록을 사용해요', '尚无账目或预算，可直接更换。': '기록과 예산이 없어 바로 바꿀 수 있어요.', '新主货币下的金额会按以下汇率固定，已存在的换算记录会直接复用。': '아래 환율로 새 금액을 고정해요. 기존 환산 기록은 그대로 사용해요.', '旧主货币下的换算记录保留，切回时可以复用。': '이전 기준 통화의 환산 기록은 보존돼요. 다시 선택하면 재사용할 수 있어요.', '预算换算后小于最小金额，请调整汇率或预算。': '환산한 예산이 최소 단위보다 작아요. 환율이나 예산을 조정해 주세요.', '换算结果超出范围，请调整汇率。': '환산 결과가 한도를 초과해요. 환율을 조정해 주세요.', '自动获取全部汇率': '전체 환율 가져오기', '换算记录': '환산 기록', '演示汇率': '미리보기 환율', '无需报价': '환율 조회가 필요 없어요'
  };
  Object.assign(dictionary, {
    '默认账本':'いつもの家計簿','账本':'家計簿','切换账本':'家計簿を切り替える','管理账本':'家計簿の管理','新增账本':'家計簿を追加','编辑账本':'家計簿を編集','账本名称':'家計簿の名前','例如：日常开销、9月旅行':'例：日々の暮らし、9月の旅行','每个账本分别记录账目、预算和分类。':'記録・予算・カテゴリは家計簿ごとに管理します。','当前账本':'現在の家計簿','使用中':'使用中','账本已创建':'家計簿を作成しました','账本已切换':'家計簿を切り替えました','账本已更新':'家計簿を更新しました','请填写账本名称。':'家計簿の名前を入力してください。','账本名称不能超过40个字符。':'名前は40文字以内で入力してください。','已经有同名账本。':'同じ名前の家計簿があります。','账本数量已达上限。':'家計簿の数が上限に達しました。','全部账本':'すべての家計簿','账本数量':'家計簿の数','完整备份包含全部账本。':'完全バックアップにはすべての家計簿が含まれます。','恢复会替换全部账本。':'復元するとすべての家計簿が置き換わります。','导出当前账本 CSV':'現在の家計簿をCSVに書き出す','当前账本的全部账目':'現在の家計簿の全記録','所属账本':'家計簿','选择分类':'カテゴリを選ぶ','英文名称':'英語の名前'
  });
  Object.assign(korean, {
    '默认账本':'기본 가계부','账本':'가계부','切换账本':'가계부 전환','管理账本':'가계부 관리','新增账本':'가계부 추가','编辑账本':'가계부 수정','账本名称':'가계부 이름','例如：日常开销、9月旅行':'예: 일상 지출, 9월 여행','每个账本分别记录账目、预算和分类。':'가계부마다 기록·예산·분류를 따로 관리해요.','当前账本':'현재 가계부','使用中':'사용 중','账本已创建':'가계부를 만들었어요','账本已切换':'가계부를 전환했어요','账本已更新':'가계부를 수정했어요','请填写账本名称。':'가계부 이름을 입력해 주세요.','账本名称不能超过40个字符。':'이름은 40자 이내로 입력해 주세요.','已经有同名账本。':'같은 이름의 가계부가 있어요.','账本数量已达上限。':'가계부 개수가 한도에 도달했어요.','全部账本':'전체 가계부','账本数量':'가계부 수','完整备份包含全部账本。':'전체 백업에는 모든 가계부가 포함돼요.','恢复会替换全部账本。':'복원하면 모든 가계부가 바뀌어요.','导出当前账本 CSV':'현재 가계부 CSV 내보내기','当前账本的全部账目':'현재 가계부의 전체 기록','所属账本':'가계부','选择分类':'분류 선택','英文名称':'영어 이름'
  });
  Object.assign(dictionary, {'恢复前会保留全部账本副本，可撤销这次恢复。':'復元前にすべての家計簿のコピーを保存するので、復元を取り消せます。','回到恢复前的全部账本':'復元前のすべての家計簿に戻す','分类名称':'カテゴリの名前'});
  Object.assign(korean, {'恢复前会保留全部账本副本，可撤销这次恢复。':'복원 전에 모든 가계부의 사본을 저장하므로 복원을 되돌릴 수 있어요.','回到恢复前的全部账本':'복원 전의 모든 가계부로 돌아가요','分类名称':'분류 이름'});
  const t = key => model.design.language === 'en' ? globalThis.LedgerEnglish?.[key] || key : model.design.language === 'ko' ? korean[key] || key : model.design.language === 'ja' ? dictionary[key] || key : key;
  const bookName = book => book.name || t('默认账本');
  const currentBookName = () => bookName(C.activeBook(collection));
  const name = id => C.categoryName(model, id);
  const cat = id => model.categories.find(item => item.id === id);
  const activeCats = type => model.categories.filter(item => item.type === type && !item.archived);
  const yearSuffix = () => model.design.language === 'en' ? '' : model.design.language === 'ko' ? '년' : '年';
  const monthSuffix = () => model.design.language === 'en' ? '' : model.design.language === 'ko' ? '월' : '月';
  const daySuffix = () => model.design.language === 'en' ? '' : model.design.language === 'ko' ? '일' : '日';
  const monthName = month => {const [y, m] = month.split('-').map(Number); return model.design.language === 'en' ? `${['January','February','March','April','May','June','July','August','September','October','November','December'][m-1]} ${y}` : model.design.language === 'ko' ? `${y}년 ${m}월` : `${y}年${m}月`;};
  const dateName = date => {const [y, m, d] = date.split('-').map(Number); return model.design.language === 'en' ? `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1]} ${d}, ${y}` : model.design.language === 'ko' ? `${y}년 ${m}월 ${d}일` : `${y}年${m}月${d}日`;};
  const button = (action, label, glyph, cls = '', extra = '') => `<button type="button" class="${cls}" data-action="${action}" ${extra}>${glyph ? icon(glyph) : ''}${label ? `<span>${e(label)}</span>` : ''}</button>`;
  const iconButton = (action, label, glyph) => button(action, '', glyph, 'll-icon-btn', `aria-label="${e(t(label))}"`);
  const errorBlock = () => `<p class="ll-error" role="alert">${e(t(error))}</p>`;
  function koala(cls = '', interactive = false) {
    const picture = `<img class="ll-koala-idle" src="images/koala-open.png" alt="" draggable="false" width="160" height="180">${interactive ? '<img class="ll-koala-blink" src="images/koala-idle.png" alt="" draggable="false" width="160" height="180"><img class="ll-koala-wave" src="images/koala-wave.png" alt="" draggable="false" width="160" height="180"><span class="ll-koala-reply" aria-hidden="true"></span>' : ''}`;
    return interactive ? `<button type="button" class="ll-koala ${cls}" data-action="koala" aria-label="${e(t('点点考拉'))}" ${model.design.mascot ? '' : 'hidden'}>${picture}</button>` : `<div class="ll-koala ${cls}" role="img" aria-label="${e(t('考拉'))}" ${model.design.mascot ? '' : 'hidden'}>${picture}</div>`;
  }
  function top(title, subtitle = '', back = false) {return `<header class="ll-top">${back ? iconButton('back', '返回', 'arrow-left') : `<div class="ll-brand-mark"><img src="images/koala-avatar.png" alt="" draggable="false" width="52" height="52"></div>`}<div class="ll-top-title"><h1>${e(title)}</h1>${subtitle ? `<p>${e(subtitle)}</p>` : ''}</div>${back ? '' : iconButton('settings', '我的', 'sliders-horizontal')}</header>${!back && ['home','stats','budgets','settings'].includes(screen) ? bookBar() : ''}`;}
  function period() {return `<div class="ll-period"><button type="button" class="ll-month-picker" data-action="months" aria-label="${e(t('选择月份'))}">${e(monthName(selectedMonth))}${icon('chevron-down')}</button><div class="ll-period-actions"><button class="ll-icon-btn" type="button" data-move-month="-1" aria-label="${e(t('上一月'))}" ${selectedMonth === '0001-01' ? 'disabled' : ''}>${icon('chevron-left')}</button><button class="ll-icon-btn" type="button" data-move-month="1" aria-label="${e(t('下一月'))}" ${selectedMonth === '9999-12' ? 'disabled' : ''}>${icon('chevron-right')}</button>${button('today', t('今天'), '', 'll-today')}</div></div>`;}
  function hero(annual = false) {
    const totals = C.totals(annual ? model.transactions.filter(item => Number(item.date.slice(0, 4)) === viewYear) : C.monthRecords(model, selectedMonth));
    const current = selectedMonth === currentMonth;
    return `<section class="ll-hero ${totals.expense >= 1000000 || money(totals.expense).length > 8 ? 'wide-amount' : ''}"><div class="ll-hero-main"><span class="ll-currency">${e(model.currency)} <span>·</span> ${e(t('现金'))}</span><p class="ll-hero-label">${e(t(annual ? '全年支出' : current ? '本月支出' : '当月支出'))}</p><div class="ll-money" data-expense-total="${totals.expense}"><small>${e(currencySymbol())}</small>${money(totals.expense)}</div></div>${koala('ll-hero-koala', !annual)}${!annual && model.design.mascot ? `<span class="ll-koala-hint">${e(t('点我一下'))}</span>` : ''}<div class="ll-hero-bottom"><div><span>${categoryIcon('coins', 'll-finance-icon', '', 'sand')}${e(t(annual ? '全年收入' : current ? '本月收入' : '当月收入'))}</span><strong class="ll-income" data-income-total="${totals.income}">+ ${money(totals.income)}</strong></div><div><span>${categoryIcon('wallet', 'll-finance-icon')}${e(t(annual ? '全年结余' : current ? '本月结余' : '当月结余'))}</span><strong data-balance-total="${totals.income - totals.expense}">${money(totals.income - totals.expense)}</strong></div></div></section>`;
  }
  function budgetCard(item, compact = false) {return `<button type="button" class="ll-budget-card ${item.state} ${Math.abs(item.remaining) >= 1000000 ? 'large-budget' : ''}" data-budget-category="${e(item.id)}"><div class="ll-budget-title">${categoryIcon(cat(item.id).icon, "", "", cat(item.id).color)}<span>${e(name(item.id))}</span>${icon('chevron-right')}</div><strong class="ll-budget-amount">${money(Math.abs(item.remaining))}<small> ${e(model.currency)}</small></strong><span class="ll-budget-state">${e(t(item.state === 'over' ? '已超支' : '预算还剩'))}${item.state === 'near' ? ` · ${e(t('接近预算'))}` : ''}</span><div class="ll-track" role="progressbar" aria-label="${e(name(item.id))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, item.percent)}"><span style="width:${Math.min(100, item.percent)}%"></span></div><div class="ll-budget-caption"><span>${e(t('已花'))} ${e(currencySymbol())}${money(item.spent)}</span><span>${item.percent}%</span></div>${compact ? '' : `<div class="ll-budget-limit">${e(t('限额'))} ${e(currencySymbol())}${money(item.limit)}${cat(item.id).archived ? ` · ${e(t('已隐藏'))}` : ''}</div>`}</button>`;}
  function empty(label, action = true) {return `<div class="ll-empty"><div class="ll-empty-leaf">${icon('notebook-pen')}</div><strong>${e(t(label))}</strong><p>${e(t('这里还空着，生活慢慢记。'))}</p>${action ? button('add', t('开始记账'), 'plus', 'll-soft-button') : ''}</div>`;}
  function budgetSection() {
    const items = C.budgetItems(model, selectedMonth);
    return `<section class="ll-section"><div class="ll-section-head"><h2>${e(t('分类预算'))}</h2>${button('budgets', t('查看全部'), 'arrow-up-right', 'll-link')}</div>${items.length ? `<div class="ll-budget-grid">${items.slice(0, 2).map(item => budgetCard(item, true)).join('')}</div>` : `<div class="ll-budget-empty"><span class="ll-category-icon">${icon('sprout')}</span><div><strong>${e(t('给生活留一点余地'))}</strong><p>${e(t('先为常用分类设一个小目标吧。'))}</p></div>${iconButton('budget-new', '设置预算', 'plus')}</div>`}</section>`;
  }
  function rows(records) {
    let previous = '';
    const sorted = records.slice().sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    const sums = new Map();
    sorted.forEach(record => {const sum = sums.get(record.date) || {income: 0, expense: 0}; sum[record.type] += converted(record); sums.set(record.date, sum);});
    const visible = sorted.slice(0, listLimit);
    return visible.map((record, index) => {
      const daySum = sums.get(record.date);
      const header = previous !== record.date ? `<div class="ll-date-heading"><strong>${e(dateName(record.date))}${record.date === today ? `<span>${e(t('今天'))}</span>` : ''}</strong><span>${daySum.expense ? `− ${e(currencySymbol())}${money(daySum.expense)}` : `+ ${e(currencySymbol())}${money(daySum.income)}`}</span></div>` : '';
      previous = record.date;
      const lastInDay = index === visible.length - 1 || visible[index + 1]?.date !== record.date;
      return (header ? '<div class="ll-day-group">' + header : '') + `<button type="button" class="ll-item ${record.type} ${lastInDay ? 'last' : ''}" data-detail="${record.id}">${categoryIcon(cat(record.category).icon, "", "", cat(record.category).color)}<span class="ll-item-text"><strong>${e(record.note || name(record.category))}</strong><span>${e(record.note ? name(record.category) : t('现金'))}</span></span><span class="ll-item-money"><strong class="ll-item-value">${record.type === 'income' ? '+' : '−'}${money(record.amount, record.currency)}</strong><small>${e(record.currency)}${record.currency !== model.currency ? ` · ${e(t('折合'))} ${e(model.currency)} ${money(converted(record))}` : ''}</small></span></button>` + (lastInDay ? '</div>' : '');
    }).join('') + (sorted.length > visible.length ? button('more-records', `${t('显示更多')} · ${sorted.length - visible.length}`, 'chevron-down', 'll-secondary ll-more') : '');
  }
  function ledgerList() {
    let records = C.monthRecords(model, selectedMonth).filter(record => !selectedDay || record.date === selectedDay);
    return `<section class="ll-section ll-ledger-list"><div class="ll-section-head"><h2>${e(t('账单明细'))}<small>${records.length} ${e(t('笔'))}</small></h2>${iconButton('search', '搜索账目', 'search')}</div>${selectedDay ? `<div class="ll-day-filter"><span>${icon('calendar-days')}${e(dateName(selectedDay))}</span>${button('all-month', t('本月全部'), 'x', 'll-link')}</div>` : ''}${records.length ? rows(records) : empty(selectedDay ? '这天还没有账目' : '这个月还没有账目')}</section>`;
  }
  function weekStrip() {
    const anchor = selectedDay || (selectedMonth === currentMonth ? today : selectedMonth + '-01');
    const monday = new Date(anchor + 'T12:00:00Z'); monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    return `<div class="ll-week-strip" aria-label="${e(t('这周'))}">${Array.from({length: 7}, (_, index) => {
      const date = new Date(monday); date.setUTCDate(monday.getUTCDate() + index); const key = date.toISOString().slice(0, 10);
      if (!C.validDate(key)) return '<span></span>';
      return `<button type="button" data-select-day="${key}" aria-pressed="${selectedDay === key}" class="${key === today ? 'is-today' : ''} ${key.slice(0, 7) !== selectedMonth ? 'other-month' : ''}" aria-label="${e(dateName(key))}"><span>${e(t(['周一', '周二', '周三', '周四', '周五', '周六', '周日'][index]))}</span><strong>${date.getUTCDate()}</strong><i aria-hidden="true">${key === today ? '·' : ''}</i></button>`;
    }).join('')}</div>`;
  }
  function home() {return top(t('小小账本'), t('每一笔，都是生活')) + period() + hero() + `<div class="ll-shortcuts">${button('year', t('年度账单'), 'calendar-range', 'll-shortcut')}${button('calendar', t('按日期查看'), 'calendar-days', 'll-shortcut')}</div>` + weekStrip() + ledgerList() + budgetSection();}
  function yearControls() {return `<div class="ll-year-controls"><button type="button" class="ll-icon-btn" data-move-year="-1" aria-label="${e(t('上一年'))}" ${viewYear === 1 ? 'disabled' : ''}>${icon('chevron-left')}</button><label><input name="view-year" type="number" min="1" max="9999" value="${viewYear}" aria-label="${e(t('年份'))}"><span>${yearSuffix()}</span></label><button type="button" class="ll-icon-btn" data-move-year="1" aria-label="${e(t('下一年'))}" ${viewYear === 9999 ? 'disabled' : ''}>${icon('chevron-right')}</button>${button('this-year', t('今年'), '', 'll-today')}</div>`;}
  function annual() {
    const months = C.yearMonths(model, viewYear), max = Math.max(1, ...months.map(month => Math.max(month.income, month.expense)));
    return top(t('年度账单'), `${viewYear}${yearSuffix()}`, true) + yearControls() + hero(true) + `<section class="ll-section"><div class="ll-section-head"><h2>${e(t('每月收支'))}</h2><span class="ll-legend"><i></i>${e(t('收入'))}<i class="expense"></i>${e(t('支出'))}</span></div><div class="ll-year-chart" role="img" aria-label="${e(t('每月收支'))}">${months.map((month, index) => `<div class="ll-year-bar"><div><span class="income" style="height:${month.income / max * 100}%"></span><span class="expense" style="height:${month.expense / max * 100}%"></span></div><small>${index + 1}</small></div>`).join('')}</div><div class="ll-year-list">${months.map((month, index) => `<button type="button" class="ll-year-month" data-view-month="${month.month}"><span class="ll-month-number">${index + 1}<small>${monthSuffix()}</small></span><span class="ll-month-mini"><span style="width:${month.expense / max * 100}%"></span></span><span class="ll-month-totals"><strong>− ${e(currencySymbol())}${money(month.expense)}</strong><span>+ ${e(currencySymbol())}${money(month.income)}</span></span>${icon('chevron-right')}</button>`).join('')}</div></section>`;
  }
  function months() {return top(t('选择月份'), '', true) + yearControls() + `<div class="ll-month-grid">${Array.from({length: 12}, (_, index) => {const month = String(viewYear).padStart(4, '0') + '-' + String(index + 1).padStart(2, '0'); return `<button type="button" data-view-month="${month}" aria-pressed="${selectedMonth === month}"><strong>${index + 1}</strong><span>${monthSuffix()}</span>${month === currentMonth ? `<i></i>` : ''}</button>`;}).join('')}</div>`;}
  function calendar() {
    const first = new Date(selectedMonth + '-01T00:00:00Z'), offset = (first.getUTCDay() + 6) % 7;
    const expenses = new Map(); C.monthRecords(model, selectedMonth).filter(record => record.type === 'expense').forEach(record => expenses.set(record.date, (expenses.get(record.date) || 0) + converted(record)));
    return top(t('按日期查看'), '', true) + period() + `<div class="ll-calendar"><div class="ll-weekdays">${['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map(day => `<span>${e(t(day))}</span>`).join('')}</div><div class="ll-calendar-grid">${Array.from({length: offset}, () => '<span></span>').join('')}${Array.from({length: C.monthLength(selectedMonth)}, (_, index) => {const date = selectedMonth + '-' + String(index + 1).padStart(2, '0'); return `<button type="button" data-select-day="${date}" aria-pressed="${date === selectedDay}" class="${date === today ? 'is-today' : ''}" aria-label="${dateName(date)}"><strong>${index + 1}</strong>${expenses.has(date) ? '<i></i>' : '<span></span>'}</button>`;}).join('')}</div></div><label class="ll-date-jump">${icon('calendar-search')}<span>${e(t('日期'))}</span><input type="date" name="filter-date" value="${selectedDay || today}" aria-label="${e(t('日期'))}" min="0001-01-01" max="9999-12-31"></label>${button('today', t('今天'), 'corner-down-left', 'll-secondary full')}`;
  }
  function stats() {
    const groups = C.categoryTotals(model, selectedMonth, statType), total = groups.reduce((sum, group) => sum + group.amount, 0);
    const colors = ['#71866a', '#a5b18d', '#d6b88a', '#91aaa5', '#b7a0aa', '#9aa0b3', '#d2c8a9', '#97a281'];
    const color = id => colors[Array.from(id).reduce((hash, ch) => (hash * 31 + ch.codePointAt(0)) >>> 0, 0) % colors.length];
    let start = 0;
    const ring = groups.map((group, index) => {const share = total ? group.amount / total * 100 : 0; const arc = `<circle cx="70" cy="70" r="51" fill="none" stroke="${color(group.id)}" stroke-width="16" pathLength="100" stroke-dasharray="${Math.max(0, share - 0.8)} ${100 - Math.max(0, share - 0.8)}" stroke-dashoffset="${-start}"/>`; start += share; return arc;}).join('');
    const largest = groups[0];
    const daily = new Map(); C.monthRecords(model, selectedMonth).filter(record => record.type === statType).forEach(record => daily.set(record.date, (daily.get(record.date) || 0) + converted(record)));
    const bars = Array.from({length: C.monthLength(selectedMonth)}, (_, index) => {const date = selectedMonth + '-' + String(index + 1).padStart(2, '0'); return {date, amount: daily.get(date) || 0};});
    const max = Math.max(1, ...bars.map(bar => bar.amount));
    const donut = total > 0 ? `<svg viewBox="0 0 140 140" class="ll-donut" role="img" aria-label="${e(t('分类占比'))}"><circle cx="70" cy="70" r="51" fill="none" stroke="#eef0e7" stroke-width="16"/>${ring}<text x="70" y="68" text-anchor="middle">${Math.round(largest.amount / total * 100)}%</text><text x="70" y="87" text-anchor="middle" class="ll-ring-small">${e(t(statType === 'expense' ? '最多支出' : '最多收入'))}</text></svg>` : `<div class="ll-zero-donut"><strong>0%</strong><span>${e(model.currency)} 0</span></div>`;
    return top(t('钱都花在哪了'), t('统计')) + period() + `<div class="ll-segment">${['expense', 'income'].map(type => `<button type="button" data-stat-type="${type}" aria-pressed="${type === statType}">${e(t(type === 'expense' ? '支出' : '收入'))}</button>`).join('')}</div><div class="ll-stat-heading"><span>${e(t(statType === 'expense' ? '当月支出' : '当月收入'))} · ${e(model.currency)}</span><strong>${e(currencySymbol())}${money(total)}</strong></div>${groups.length ? `<section class="ll-donut-card">${donut}<div>${categoryIcon(cat(largest.id).icon, "", "", cat(largest.id).color)}<h3>${e(name(largest.id))}</h3><strong>${e(currencySymbol())}${money(largest.amount)}</strong></div></section><section class="ll-section"><div class="ll-section-head"><h2>${e(t('分类占比'))}</h2></div><div class="ll-analytics-list">${groups.map((group, index) => `<button type="button" class="ll-analytics-row" data-filter-category="${e(group.id)}">${categoryIcon(cat(group.id).icon, "", "--category-color:" + color(group.id), cat(group.id).color)}<span class="ll-analytics-name"><strong>${e(name(group.id))}</strong><span class="ll-track"><span style="width:${total ? group.amount / total * 100 : 0}%;background:${color(group.id)}"></span></span></span><span class="ll-analytics-amount"><strong>${e(currencySymbol())}${money(group.amount)}</strong><small>${(total ? group.amount / total * 100 : 0).toFixed(1)}%</small></span>${icon('chevron-right')}</button>`).join('')}</div></section>` : empty('这段时间还没有记录')}<section class="ll-section"><div class="ll-section-head"><h2>${e(t('每日趋势'))}</h2><span class="ll-caption">${e(model.currency)}</span></div><div class="ll-trend"><span class="ll-trend-max">${e(currencySymbol())}${money(max === 1 && !total ? 0 : max)}</span><svg viewBox="0 0 310 115" class="ll-trend-chart" role="img" aria-label="${e(t('每日趋势'))}" data-trend-chart><line x1="0" y1="95" x2="310" y2="95" stroke="#e4e8dd"/>${bars.map((bar, index) => `<rect x="${index * 310 / bars.length + 1}" y="${95 - bar.amount / max * 82}" width="${Math.max(2, 310 / bars.length - 3)}" height="${bar.amount / max * 82}" rx="2" fill="${bar.date === trendDay ? '#405b43' : '#a0b391'}"/>`).join('')}<text x="0" y="112">1${daySuffix()}</text><text x="155" y="112" text-anchor="middle">15${daySuffix()}</text><text x="310" y="112" text-anchor="end">${bars.length}${daySuffix()}</text></svg><div class="ll-trend-selection">${trendDay ? `${dateName(trendDay)} · ${e(currencySymbol())}${money(bars.find(bar => bar.date === trendDay)?.amount || 0)}` : `${monthName(selectedMonth)} · ${e(t(statType === 'expense' ? '支出' : '收入'))}`}</div></div></section>`;
  }
  function invalidateRate() {rateRequest = null; rateSequence++; if (draft) draft.rateLoading = false;}
  function prepareCurrency(currency) {
    invalidateRate(); draft.currency = currency; draft.rateLoading = false; draft.rateFailed = false;
    const cached = model.exchangeRates[currency];
    draft.rate = currency === model.currency ? '1' : cached?.rate || '';
    draft.rateDate = cached?.date || ''; draft.rateUpdatedAt = cached?.updatedAt || 0; draft.rateSource = currency === model.currency ? 'base' : cached ? 'cache' : 'none';
  }
  function conversionPreview() {
    const amount = C.calculate(draft.amount, draft.currency);
    const value = amount !== null && C.validRate(draft.rate) ? C.convertAmount(amount, draft.currency, model.currency, draft.rate) : null;
    return `${e(t('折合'))} <strong>${e(model.currency)} ${value === null ? '—' : money(value)}</strong>`;
  }
  function updateConversionPreview() {const target = phone.querySelector('[data-conversion-preview]'); if (target) target.innerHTML = conversionPreview();}
  function exchangePanel() {
    if (draft.currency === model.currency) return '';
    const source = {cache: '最近缓存', manual: '手动汇率', record: '原记录汇率', live: '最新汇率', demo: '演示汇率', none: '汇率'}[draft.rateSource] || '汇率';
    return `<section class="ll-exchange-panel"><div class="ll-exchange-head"><strong>${e(t('汇率'))}</strong>${button('refresh-rate', t('更新汇率'), 'refresh-cw', 'll-link', draft.rateLoading ? 'disabled' : '')}</div><label class="ll-rate-entry"><span>1 ${e(draft.currency)} =</span><input name="exchange-rate" inputmode="decimal" maxlength="20" value="${e(draft.rate)}" placeholder="0" aria-label="${e(t('汇率'))}"><span>${e(model.currency)}</span></label><div class="ll-rate-meta"><span>${e(t(draft.rateLoading ? '正在获取汇率' : source))}${draft.rateDate ? ` · ${e(draft.rateDate)}` : ''}</span><span data-conversion-preview>${conversionPreview()}</span></div>${draft.rateFailed ? `<p class="ll-rate-error">${e(t('暂时无法联网，可使用缓存或手动输入汇率。'))}</p>` : ''}<p class="ll-caption">${e(t('保存时会固定这笔汇率，不随以后的报价变化。'))}</p></section>`;
  }
  function updateExchangePanel() {
    const panel = phone.querySelector('.ll-exchange-panel'); if (panel) panel.outerHTML = exchangePanel();
    if (globalThis.lucide) lucide.createIcons({attrs: {width: 20, height: 20, 'stroke-width': 1.8}});
  }
  function requestDraftRate() {
    if (screen !== 'add' || draft.currency === model.currency) return;
    const request = {id: 'rate-' + Date.now().toString(36) + '-' + (++rateSequence), currency: draft.currency, base: model.currency};
    rateRequest = request; draft.rateLoading = true; draft.rateFailed = false; updateExchangePanel();
    try {if (!store.rate || store.rate(request.currency, request.base, request.id) === false) throw new Error('rate_unavailable');}
    catch {globalThis.ledgerRateReady({...request, status: 'error'});}
  }
  globalThis.ledgerRateReady = result => {
    if (rebaseRequest && result.id === rebaseRequest.id) {receiveRebaseRate(result); return;}
    if (!rateRequest || result.id !== rateRequest.id || screen !== 'add' || result.currency !== draft.currency || result.base !== model.currency) return;
    rateRequest = null; draft.rateLoading = false;
    if (['success', 'cached'].includes(result.status) && C.validRate(result.rate)) {
      const keepLocalCache = result.status === 'cached' && draft.rateSource === 'cache' && C.validRate(draft.rate) && (draft.rateUpdatedAt || 0) >= (result.updatedAt || 0);
      if (!keepLocalCache) {draft.rate = String(result.rate); draft.rateDate = C.validDate(result.date) ? result.date : ''; draft.rateUpdatedAt = Number.isSafeInteger(result.updatedAt) && result.updatedAt >= 0 ? result.updatedAt : Date.now();}
      draft.rateSource = result.demo ? 'demo' : result.status === 'cached' ? 'cache' : 'live'; draft.rateFailed = result.status === 'cached';
      if (error === '请输入有效汇率。') {error = ''; const alert = phone.querySelector('.ll-error'); if (alert) alert.textContent = '';}
    } else draft.rateFailed = true;
    updateExchangePanel();
  };
  function startAdd() {
    refreshClock(); const type = 'expense'; const active = activeCats(type);
    draft = {type, category: active.find(item => item.id === model.design.lastExpenseCategory)?.id || active[0].id, amount: '', date: selectedDay || (selectedMonth === currentMonth ? today : selectedMonth + '-01'), note: ''};
    prepareCurrency(model.design.lastCurrency || model.currency); editId = null; go('add');
    if (draft.currency !== model.currency) requestDraftRate();
  }
  function addPage() {
    const keys = ['1', '2', '3', 'backspace', '4', '5', '6', '+', '7', '8', '9', '-', 'clear', '0', C.currencyInfo(draft.currency).digits ? '.' : '00', '='];
    return top(t(editId ? '修改账目' : '记一笔'), currentBookName(), true) + `<div class="ll-segment">${['expense', 'income'].map(type => `<button type="button" data-type="${type}" aria-pressed="${draft.type === type}">${e(t(type === 'expense' ? '支出' : '收入'))}</button>`).join('')}</div><div class="ll-amount-box"><div class="ll-currency-row"><span>${e(t('金额'))}</span><button type="button" class="ll-select-trigger" data-action="pick-entry-currency" aria-haspopup="dialog" aria-label="${e(t('这笔的货币'))}"><span>${e(currencyLabel(draft.currency))}</span>${icon('chevron-down')}</button></div><div class="ll-amount-value"><b>${e(currencySymbol(draft.currency))}</b><input name="amount" inputmode="none" autocomplete="off" maxlength="32" placeholder="0" value="${e(draft.amount)}" aria-label="${e(t('金额'))}"></div></div>${exchangePanel()}<div class="ll-form-section-head"><span>${e(t('分类'))}</span>${button('manage-categories', t('管理'), 'sliders-horizontal', 'll-link')}</div><div class="ll-categories">${model.categories.filter(category => category.type === draft.type && (!category.archived || category.id === draft.category)).map(category => `<button type="button" data-category="${e(category.id)}" aria-pressed="${category.id === draft.category}">${categoryIcon(category.icon, '', '', category.color)}<span>${e(name(category.id))}</span></button>`).join('')}</div><div class="ll-entry-extras"><label class="ll-entry-date">${icon('calendar-days')}<input type="date" name="entry-date" value="${draft.date}" min="0001-01-01" max="9999-12-31" aria-label="${e(t('日期'))}"></label>${button('draft-today', t('今天'), '', 'll-today')}</div><label class="ll-note-row">${icon('pencil-line')}<input name="note" type="text" maxlength="200" placeholder="${e(t('备注'))} · ${e(t('选填'))}" value="${e(draft.note)}" aria-label="${e(t('备注'))}"></label>${draft.date > today ? `<p class="ll-future-note">${icon('calendar-clock')}${e(t('未来日期'))} · ${e(t('这笔会计入所选月份的收支和预算。'))}</p>` : ''}${errorBlock()}<div class="ll-keypad">${keys.map(key => `<button type="button" data-key="${key}" class="${['backspace', '+', '-', '=', 'clear'].includes(key) ? 'operator' : ''}" aria-label="${e(key === 'clear' ? t('清空') : key === 'backspace' ? t('删除') : key)}">${key === 'backspace' ? icon('delete') : key === 'clear' ? t('清空') : key === '-' ? '−' : key}</button>`).join('')}</div><div class="ll-save-row">${editId ? '' : button('save-next', t('保存，再记一笔'), 'list-plus', 'll-secondary')}${button('save-record', t(editId ? '保存修改' : '保存'), 'check', 'll-primary')}</div>`;
  }
  function detail() {
    const record = model.transactions.find(item => item.id === detailId); if (!record) return top(t('明细'), '', true) + empty('没有符合条件的账目', false);
    const facts = [['所属账本', currentBookName()], ['日期', dateName(record.date)], ['收支类型', t(record.type === 'expense' ? '支出' : '收入')], ['支付方式', t('现金')], ['货币', record.currency]];
    if (record.currency !== model.currency) {facts.push(['折合', C.formatMoney(converted(record), model.currency)], ['原记录汇率', `1 ${record.currency} = ${record.rate} ${model.currency}`]); if (record.rateDate) facts.push(['报价日期', record.rateDate]);}
    const saved = Object.entries(record.valuations || {}).filter(([base]) => base !== model.currency);
    if (saved.length) facts.push(['换算记录', saved.map(([base, valuation]) => `${base} ${money(valuation.convertedAmount, base)} · 1 ${record.currency} = ${valuation.rate} ${base}${valuation.rateDate ? ` · ${valuation.rateDate}` : ''}`).join('\n')]);
    return top(t('明细'), '', true) + `<section class="ll-detail">${categoryIcon(cat(record.category).icon, "ll-detail-icon", "", cat(record.category).color)}<h2>${e(name(record.category))}</h2><div class="ll-detail-money ${record.type}">${record.type === 'income' ? '+' : '−'} ${e(currencySymbol(record.currency))}${money(record.amount, record.currency)}</div><div class="ll-detail-card">${facts.map(([label, value]) => `<div><span>${e(t(label))}</span><strong>${e(value)}</strong></div>`).join('')}</div><div class="ll-detail-note"><span>${icon('pencil-line')}${e(t('备注'))}</span><p>${e(record.note || t('没有备注'))}</p></div>${errorBlock()}${button('edit', t('编辑'), 'pencil-line', 'll-primary full')}${button('delete', t('删除'), 'trash-2', 'll-danger full')}</section>`;
  }
  function budgetsPage() {
    const items = C.budgetItems(model, selectedMonth), previous = C.moveMonth(selectedMonth, -1);
    return top(t('分类预算'), t('给生活留一点余地')) + period() + `<div class="ll-budget-intro"><span class="ll-category-icon">${icon('sprout')}</span><p>${e(t('设置这个月的分类预算'))}</p></div>${items.length ? `<div class="ll-budget-grid">${items.map(item => budgetCard(item)).join('')}</div>` : empty('还没有设置预算', false)}${button('budget-new', t('添加分类预算'), 'plus', 'll-primary full')}${previous !== selectedMonth && Object.keys(model.budgets[previous] || {}).length ? button('copy-budgets', t('沿用上月预算'), 'copy', 'll-secondary full') : ''}${errorBlock()}`;
  }
  function budgetForm() {
    return top(t('调整预算'), monthName(selectedMonth), true) + `<div class="ll-editor-card"><label>${e(t('分类'))}<button type="button" class="ll-select-trigger" data-action="pick-budget-category" aria-haspopup="dialog">${categoryIcon(cat(budgetCategory).icon, '', '', cat(budgetCategory).color)}<span>${e(name(budgetCategory))}</span>${icon('chevron-down')}</button></label><label class="ll-budget-input">${e(t('预算金额'))} · ${e(model.currency)}<input type="text" name="budget" inputmode="${C.currencyInfo(model.currency).digits ? 'decimal' : 'numeric'}" maxlength="12" value="${e(budgetDraft)}" placeholder="0"></label><p class="ll-caption">${e(t('只计算所选月份、这个分类的支出。'))}</p></div>${errorBlock()}${button('save-budget', t('保存'), 'check', 'll-primary full')}${model.budgets[selectedMonth]?.[budgetCategory] ? button('remove-budget', t('取消这项预算'), 'trash-2', 'll-danger full') : ''}`;
  }
  function settingsRow(action, title, sub, glyph, trailing = '') {return `<button type="button" class="ll-settings-row" data-action="${action}"><span class="ll-category-icon">${icon(glyph)}</span><span><strong>${e(t(title))}</strong>${sub ? `<small>${e(t(sub))}</small>` : ''}</span>${trailing ? `<span class="ll-setting-value">${e(trailing)}</span>` : ''}${icon('chevron-right')}</button>`;}
  function canUndo() {try {return !!undoModel || !!store.hasUndo?.();} catch {return false;}}
  function settings() {return top(t('我的账本'), '') + `<section class="ll-profile">${koala('ll-profile-koala')}<div><h2>${e(t('慢慢记录，好好生活。'))}</h2><span>${icon('shield-check')}${e(t('数据保存在这部手机里'))}</span></div></section><section class="ll-section"><div class="ll-section-head"><h2>${e(t('账本设置'))}</h2></div><div class="ll-settings-group">${settingsRow('books', '管理账本', '', 'notebook-pen')}${settingsRow('language', '界面语言', '', 'languages', {zh: '中文', ja: '日本語', ko: '한국어', en: 'English'}[model.design.language])}${settingsRow('currencies', '主货币', '', 'banknote', model.currency)}${settingsRow('manage-categories', '自定义分类', '', 'shapes')}${settingsRow('toggle-motion', '轻快动画', '', 'sparkles', t(model.design.animations === false ? '停用' : '开启'))}</div></section><section class="ll-section"><div class="ll-section-head"><h2>${e(t('备份与导出'))}</h2></div><div class="ll-settings-group">${settingsRow('export-backup', '保存完整备份', '完整备份包含全部账本。', 'download')}${settingsRow('import-backup', '从文件恢复', '选择以前保存的完整备份', 'folder-open')}${settingsRow('export-csv', '导出当前账本 CSV', '当前账本的全部账目', 'file-spreadsheet')}${canUndo() ? settingsRow('undo-restore', '撤销上次恢复', '回到恢复前的全部账本', 'undo-2') : ''}</div></section><p class="ll-settings-note">${e(t('备份文件包含你的账目，请妥善保管。'))}</p><p class="ll-settings-note">${e(t('仅联网获取汇率，账目仍保存在手机里。'))}</p>${errorBlock()}<footer class="ll-footer">${icon('leaf')} ${e(t('小小账本'))} · 0.5.0</footer>`;}
  function currencySettings() {return top(t('主货币'), '', true) + `<div class="ll-currency-intro"><span class="ll-category-icon">${icon('banknote')}</span><p>${e(t('主货币用于统计和预算，每一笔都可以选择不同货币。'))}</p></div><div class="ll-currency-choices">${C.CURRENCIES.map(code => `<button type="button" data-base-currency="${code}" aria-pressed="${code === model.currency}"><strong>${code}</strong><span>${e(currencyName(code))}</span>${code === model.currency ? icon('check-circle-2') : ''}</button>`).join('')}</div><p class="ll-settings-note">${e(t('账目和预算将一起换算，原币金额和旧换算记录会保留。'))}</p>${errorBlock()}`;}
  function languageSettings() {return top(t('选择语言'), '', true) + `<div class="ll-language-choices">${[['zh', '中文'], ['ja', '日本語'], ['ko', '한국어'], ['en', 'English']].map(([language, label]) => `<button type="button" class="ll-settings-row" data-language="${language}" aria-pressed="${language === model.design.language}"><span class="ll-category-icon">${icon('languages')}</span><span><strong>${label}</strong></span>${language === model.design.language ? icon('check-circle-2') : icon('chevron-right')}</button>`).join('')}</div>${errorBlock()}`;}
  function beginRebase(target) {
    if (target === model.currency || !C.CURRENCIES.includes(target)) return;
    const plan = C.rebasePlan(model, target);
    rebaseDraft = {target, source: model.currency, plan, quotes: Object.fromEntries(plan.currencies.map(currency => [currency, {rate: '', date: '', source: 'none', revision: 0}])), queue: [...plan.currencies]};
    go('currency-change'); advanceRebaseQueue();
  }
  function stopRebase() {clearTimeout(rebaseTimer); rebaseRequest = null; if (rebaseDraft) rebaseDraft.queue = []; rebaseDraft = null;}
  function rebaseQuotes() {return Object.fromEntries(Object.entries(rebaseDraft.quotes).map(([currency, quote]) => {const value = {rate: quote.rate}; if (C.validDate(quote.date)) value.date = quote.date; if (Number.isSafeInteger(quote.updatedAt) && quote.updatedAt >= 0) value.updatedAt = quote.updatedAt; return [currency, value];}));}
  function rebasePreviewResult() {
    if (!rebaseDraft || rebaseDraft.plan.currencies.some(currency => !C.validRate(rebaseDraft.quotes[currency]?.rate))) return {ready: false, error: '缺少有效汇率，请更新或手动填写。'};
    try {return {ready: true, model: C.rebaseCurrency(model, rebaseDraft.target, rebaseQuotes())};}
    catch (failure) {return {ready: false, error: failure.message === 'budget_too_small' ? '预算换算后小于最小金额，请调整汇率或预算。' : failure.message === 'missing_rebase_rate' ? '缺少有效汇率，请更新或手动填写。' : '换算结果超出范围，请调整汇率。'};}
  }
  function rebaseSummary(result = rebasePreviewResult()) {
    const oldTotals = C.totals(model.transactions), newTotals = result.ready ? C.totals(result.model.transactions) : null;
    return `<div class="ll-rebase-summary"><div class="ll-rebase-heading"><strong>${e(t('换算预览'))}</strong><span>${e(model.currency)} → ${e(rebaseDraft.target)}</span></div>${[['全部支出', oldTotals.expense, newTotals?.expense], ['全部收入', oldTotals.income, newTotals?.income]].map(([label, before, after]) => `<div class="ll-rebase-total"><span>${e(t(label))}</span><span><small>${e(model.currency)} ${money(before)}</small><strong>${e(rebaseDraft.target)} ${after === undefined ? '—' : money(after, rebaseDraft.target)}</strong></span></div>`).join('')}<div class="ll-rebase-total"><span>${e(t('换算预算'))}</span><strong>${rebaseDraft.plan.budgetCount} ${e(t('项'))}</strong></div>${result.ready ? '' : `<p class="ll-rate-error" role="status">${e(t(result.error))}</p>`}</div>`;
  }
  function rebaseQuoteMeta(quote) {return `${t(quote.loading ? '正在获取汇率' : {manual: '手动汇率', cache: '最近缓存', live: '最新汇率', demo: '演示汇率', none: '汇率'}[quote.source] || '汇率')}${quote.date ? ` · ${quote.date}` : ''}${quote.failed ? ` · ${t('暂时无法联网，可使用缓存或手动输入汇率。')}` : ''}`;}
  function rebasePage() {
    if (!rebaseDraft) return currencySettings();
    const result = rebasePreviewResult();
    return top(t('更改主货币'), `${model.currency} → ${rebaseDraft.target}`, true) + `<p class="ll-settings-note">${e(t('新主货币下的金额会按以下汇率固定，已存在的换算记录会直接复用。'))}</p><div data-rebase-summary>${rebaseSummary(result)}</div>${rebaseDraft.plan.currencies.length ? `<div class="ll-section-head"><h2>${e(t('所需汇率'))}</h2></div><div class="ll-rebase-quotes">${rebaseDraft.plan.currencies.map(currency => {const quote = rebaseDraft.quotes[currency]; return `<section class="ll-exchange-panel" data-rebase-quote="${currency}"><div class="ll-exchange-head"><strong>${e(currencyLabel(currency))}</strong><button type="button" class="ll-link" data-refresh-rebase="${currency}" ${quote.loading ? 'disabled' : ''}>${icon('refresh-cw')}<span>${e(t('更新汇率'))}</span></button></div><label class="ll-rate-entry"><span>1 ${currency} =</span><input name="rebase-rate" data-currency="${currency}" inputmode="decimal" maxlength="20" value="${e(quote.rate)}" placeholder="0" aria-label="${e(`${currency} → ${rebaseDraft.target} ${t('汇率')}`)}"><span>${rebaseDraft.target}</span></label><p class="ll-rebase-quote-meta" role="status">${e(rebaseQuoteMeta(quote))}</p></section>`;}).join('')}</div>${button('refresh-rebase-all', t('自动获取全部汇率'), 'refresh-cw', 'll-secondary full')}` : `<p class="ll-settings-note">${e(t(rebaseDraft.plan.transactionCount || rebaseDraft.plan.budgetCount ? '使用已保留的换算记录' : '尚无账目或预算，可直接更换。'))}</p>`}<p class="ll-settings-note">${e(t('旧主货币下的换算记录保留，切回时可以复用。'))}</p>${errorBlock()}<div class="ll-rebase-actions">${button('back', t('取消'), '', 'll-secondary')}${button('confirm-rebase', t('确认换算'), 'check', 'll-primary', result.ready ? '' : 'disabled')}</div>`;
  }
  function updateRebasePreview() {
    if (screen !== 'currency-change' || !rebaseDraft) return;
    const result = rebasePreviewResult(), summary = phone.querySelector('[data-rebase-summary]'); if (summary) summary.innerHTML = rebaseSummary(result);
    const confirm = phone.querySelector('[data-action="confirm-rebase"]'); if (confirm) confirm.disabled = !result.ready;
    for (const currency of rebaseDraft.plan.currencies) {
      const panel = phone.querySelector(`[data-rebase-quote="${currency}"]`), quote = rebaseDraft.quotes[currency]; if (!panel) continue;
      panel.querySelector('.ll-rebase-quote-meta').textContent = rebaseQuoteMeta(quote);
      panel.querySelector('[data-refresh-rebase]').disabled = !!quote.loading;
      const input = panel.querySelector('input'); if (input !== document.activeElement || quote.source !== 'manual') input.value = quote.rate;
    }
  }
  function advanceRebaseQueue() {
    if (screen !== 'currency-change' || !rebaseDraft || rebaseRequest) return;
    let currency; while (rebaseDraft.queue.length) {const next = rebaseDraft.queue.shift(); if (rebaseDraft.quotes[next]?.source !== 'manual') {currency = next; break;}}
    if (!currency) return;
    const quote = rebaseDraft.quotes[currency], request = {id: 'rebase-' + Date.now().toString(36) + '-' + (++rateSequence), currency, base: rebaseDraft.target, revision: quote.revision};
    rebaseRequest = request; quote.loading = true; quote.failed = false; updateRebasePreview();
    rebaseTimer = setTimeout(() => receiveRebaseRate({...request, status: 'error'}), 12000);
    try {if (!store.rate || store.rate(currency, request.base, request.id) === false) throw new Error('rate_unavailable');}
    catch {receiveRebaseRate({...request, status: 'error'});}
  }
  function receiveRebaseRate(result) {
    if (screen !== 'currency-change' || !rebaseDraft || !rebaseRequest || result.id !== rebaseRequest.id || result.currency !== rebaseRequest.currency || result.base !== rebaseDraft.target) return;
    const request = rebaseRequest, quote = rebaseDraft.quotes[request.currency]; clearTimeout(rebaseTimer); rebaseRequest = null;
    if (quote && quote.revision === request.revision) {
      quote.loading = false;
      if (['success', 'cached'].includes(result.status) && C.validRate(result.rate)) {quote.rate = String(result.rate); quote.date = C.validDate(result.date) ? result.date : ''; quote.updatedAt = Number.isSafeInteger(result.updatedAt) && result.updatedAt >= 0 ? result.updatedAt : Date.now(); quote.source = result.demo ? 'demo' : result.status === 'cached' ? 'cache' : 'live'; quote.failed = result.status === 'cached';}
      else quote.failed = true;
    }
    updateRebasePreview(); advanceRebaseQueue();
  }
  function requestRebaseQuote(currency) {
    if (!rebaseDraft?.quotes[currency]) return;
    if (rebaseRequest) {clearTimeout(rebaseTimer); rebaseDraft.quotes[rebaseRequest.currency].loading = false; const cancelled = rebaseRequest.currency; rebaseRequest = null; if (cancelled !== currency && rebaseDraft.quotes[cancelled].source !== 'manual') rebaseDraft.queue.push(cancelled);}
    rebaseDraft.quotes[currency].source = 'none'; rebaseDraft.quotes[currency].revision++; rebaseDraft.queue = [currency, ...rebaseDraft.queue.filter(item => item !== currency)]; advanceRebaseQueue();
  }
  function manageCategories() {return top(t('自定义分类'), '', true) + `<div class="ll-segment">${['expense', 'income'].map(type => `<button type="button" data-category-type="${type}" aria-pressed="${categoryType === type}">${e(t(type === 'expense' ? '支出' : '收入'))}</button>`).join('')}</div><div class="ll-category-list">${model.categories.filter(category => category.type === categoryType).map(category => `<div class="ll-category-manage-row ${category.archived ? 'archived' : ''}"><button type="button" class="ll-category-edit" data-edit-category="${e(category.id)}">${categoryIcon(category.icon, "", "", category.color)}<span><strong>${e(name(category.id))}</strong><small>${e(model.design.language === 'en' ? '' : model.design.language === 'zh' ? category.nameJa : category.nameZh)}${category.archived ? ` · ${e(t('已隐藏'))}` : ''}</small></span></button><button type="button" class="ll-icon-btn" data-order-category="${e(category.id)}" data-direction="-1" aria-label="${e(t('上移'))}">${icon('arrow-up')}</button><button type="button" class="ll-icon-btn" data-order-category="${e(category.id)}" data-direction="1" aria-label="${e(t('下移'))}">${icon('arrow-down')}</button><button type="button" class="ll-icon-btn" data-archive-category="${e(category.id)}" aria-label="${e(t(category.archived ? '显示' : '隐藏'))}">${icon(category.archived ? 'eye-off' : 'eye')}</button></div>`).join('')}</div>${button('category-new', t('新增分类'), 'plus', 'll-primary full')}<p class="ll-settings-note">${e(t('隐藏后，历史账目与预算仍会保留。'))}</p>${errorBlock()}`;}
  function categoryEditor() {return top(t(categoryDraft.existing ? '编辑分类' : '新增分类'), t(categoryDraft.type === 'expense' ? '支出' : '收入'), true) + `<div class="ll-editor-card"><label>${e(t(model.design.language === 'en' ? '分类名称' : '中文名称'))}<input name="category-zh" type="text" maxlength="40" value="${e(categoryDraft.nameZh)}"></label><label>${e(t('日文名称'))} · ${e(t('选填'))}<input name="category-ja" type="text" maxlength="40" value="${e(categoryDraft.nameJa || '')}"></label><label>${e(t('韩文名称'))} · ${e(t('选填'))}<input name="category-ko" type="text" maxlength="40" value="${e(categoryDraft.nameKo || '')}"></label><label>${e(t('英文名称'))} · ${e(t('选填'))}<input name="category-en" type="text" maxlength="40" value="${e(categoryDraft.nameEn || '')}"></label><p class="ll-caption">${e(t('其他语言留空时显示中文名称。'))}</p></div><div class="ll-category-preview" aria-label="${e(t('分类预览'))}">${categoryIcon(categoryDraft.icon, '', '', categoryDraft.color)}<span>${e(categoryDraft.nameZh || t('新增分类'))}</span></div><div class="ll-section-head"><h2>${e(t('背景色'))}</h2></div><div class="ll-color-picker">${[['sage', '鼠尾草绿'], ['peach', '蜜桃粉'], ['sand', '奶油黄'], ['lilac', '淡紫色'], ['sky', '天空蓝']].map(([color, label]) => `<button type="button" data-color="${color}" aria-pressed="${color === categoryDraft.color}" aria-label="${e(t(label))}"><span class="ll-color-dot" data-color="${color}">${color === categoryDraft.color ? icon('check') : ''}</span><small>${e(t(label))}</small></button>`).join('')}</div><div class="ll-section-head"><h2>${e(t('图标'))}</h2></div><div class="ll-icon-picker">${C.ICONS.map(glyph => `<button type="button" data-icon="${glyph}" aria-pressed="${glyph === categoryDraft.icon}" aria-label="${e(iconLabel(glyph))}">${categoryIcon(glyph, '', '', categoryDraft.color)}</button>`).join('')}</div>${errorBlock()}${button('save-category', t('保存'), 'check', 'll-primary full')}`;}
  function search() {
    const text = query.trim().toLowerCase();
    const records = C.monthRecords(model, selectedMonth).filter(record => !text || [record.note, name(record.category), amountInput(record.amount, record.currency), amountInput(converted(record)), record.currency, record.date].some(value => String(value).toLowerCase().includes(text)));
    return top(t('搜索账目'), monthName(selectedMonth), true) + `<label class="ll-search-box">${icon('search')}<input type="search" name="query" placeholder="${e(t('搜索分类、备注或金额'))}" value="${e(query)}" autocomplete="off"></label><div class="ll-search-results">${records.length ? rows(records) : empty('没有符合条件的账目', false)}</div>`;
  }
  function categoryDetails() {const records = C.monthRecords(model, selectedMonth).filter(record => record.category === filterCategory && record.type === statType); return top(name(filterCategory), monthName(selectedMonth), true) + `<div class="ll-stat-heading"><span>${e(t(statType === 'expense' ? '支出' : '收入'))} · ${records.length} ${e(t('笔'))}</span><strong>${e(currencySymbol())}${money(records.reduce((sum, record) => sum + converted(record), 0))}</strong></div>` + rows(records);}
  function restorePreview() {
    if (!pendingBackup) return settings();
    const data = pendingBackup.data, records = data.books.flatMap(book => book.data.transactions), dates = records.map(item => item.date).sort();
    const exported = pendingBackup.exportedAt && !Number.isNaN(Date.parse(pendingBackup.exportedAt)) ? new Date(pendingBackup.exportedAt).toLocaleString(model.design.language === 'ko' ? 'ko-KR' : model.design.language === 'ja' ? 'ja-JP' : model.design.language === 'en' ? 'en-US' : 'zh-CN', {timeZone: 'Asia/Tokyo'}) : '—';
    return top(t('恢复备份'), t('请先确认备份内容'), true) + `<div class="ll-restore-icon">${icon('archive-restore')}</div><div class="ll-detail-card ll-restore-summary">${[['账本数量', data.books.length], ['账目数量', `${records.length} ${t('笔')}`], ['日期范围', dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : '—'], ['预算月份', data.books.reduce((count, book) => count + Object.values(book.data.budgets).filter(limits => Object.keys(limits).length).length, 0)], ['全部账本', data.books.map(bookName).join(' · ')], ['备份时间', exported]].map(([label, value]) => `<div><span>${e(t(label))}</span><strong>${e(value)}</strong></div>`).join('')}</div><p class="ll-settings-note">${e(t(store.failedToLoad ? '原始文件会保留副本。' : '恢复前会保留全部账本副本，可撤销这次恢复。'))}</p>${errorBlock()}${button('restore-confirm', t('恢复这份备份'), 'archive-restore', 'll-primary full')}`;
  }
  function bookBar() {return `<button type="button" class="ll-book-bar" data-action="books" aria-label="${e(t('切换账本'))}">${icon('notebook-pen')}<span><strong>${e(currentBookName())}</strong><small>${e(model.currency)}</small></span>${icon('chevron-down')}</button>`;}
  function booksPage() {return top(t('管理账本'), t('切换账本'), true) + `<div class="ll-book-intro">${categoryIcon('book-open')}<p>${e(t('每个账本分别记录账目、预算和分类。'))}</p></div><div class="ll-books-list">${collection.books.map(book => `<section class="ll-book-card" data-active="${book.id === collection.activeBookId}"><button type="button" class="ll-book-switch" data-switch-book="${e(book.id)}" aria-pressed="${book.id === collection.activeBookId}">${categoryIcon(book.id === 'default' ? 'house' : 'book-open')}<span class="ll-book-copy"><strong>${e(bookName(book))}</strong><small>${e(book.data.currency)} · ${book.data.transactions.length} ${e(t('笔'))}</small></span>${book.id === collection.activeBookId ? `<span class="ll-book-status">${icon('check')}${e(t('使用中'))}</span>` : icon('chevron-right')}</button><button type="button" class="ll-icon-btn" data-edit-book="${e(book.id)}" aria-label="${e(t('编辑账本'))} · ${e(bookName(book))}">${icon('pencil-line')}</button></section>`).join('')}</div>${button('book-new', t('新增账本'), 'plus', 'll-primary full')}${errorBlock()}`;}
  function bookEditor() {return top(t(editingBookId ? '编辑账本' : '新增账本'), '', true) + `<div class="ll-editor-card ll-book-form"><label>${e(t('账本名称'))}<input name="book-name" type="text" maxlength="40" value="${e(bookNameDraft)}" placeholder="${e(t('例如：日常开销、9月旅行'))}" autocomplete="off"></label><p class="ll-caption">${e(t('每个账本分别记录账目、预算和分类。'))}</p></div>${errorBlock()}${button('save-book', t('保存'), 'check', 'll-primary full')}`;}
  function closePicker() {picker = null; render(); phone.querySelector(`[data-action="${pickerReturnFocus}"]`)?.focus({preventScroll:true});}
  function pickerView() {
    if (!picker) return '';
    const currency = picker === 'currency', title = currency ? '选择货币' : '选择分类';
    const options = currency ? C.CURRENCIES.map(code => `<button type="button" class="ll-picker-option" data-pick-currency="${code}" aria-pressed="${code === draft.currency}"><span class="ll-picker-token">${e(currencySymbol(code))}</span><span class="ll-picker-copy"><strong>${e(currencyName(code))}</strong><small>${code}</small></span><span class="ll-picker-check">${code === draft.currency ? icon('check-circle-2') : ''}</span></button>`).join('') : model.categories.filter(category => category.type === 'expense' && (!category.archived || category.id === budgetCategory)).map(category => `<button type="button" class="ll-picker-option" data-pick-budget-category="${e(category.id)}" aria-pressed="${category.id === budgetCategory}">${categoryIcon(category.icon, '', '', category.color)}<span class="ll-picker-copy"><strong>${e(name(category.id))}</strong></span><span class="ll-picker-check">${category.id === budgetCategory ? icon('check-circle-2') : ''}</span></button>`).join('');
    return `<div class="ll-picker-shade"><section class="ll-picker" role="dialog" aria-modal="true" aria-labelledby="ll-picker-title"><div class="ll-picker-handle" aria-hidden="true"></div><header class="ll-picker-heading"><div><h2 id="ll-picker-title">${e(t(title))}</h2><p>${e(currency ? t('这笔的货币') : currentBookName())}</p></div>${iconButton('close-picker', '关闭', 'x')}</header><div class="ll-picker-options">${options}</div></section></div>`;
  }
  function navigation() {return `<nav class="ll-nav" aria-label="${e(t('账本设置'))}">${[['home', '账单', 'notebook-pen'], ['stats', '统计', 'chart-no-axes-combined'], ['add', '记一笔', 'plus'], ['budgets', '预算', 'wallet'], ['settings', '我的', 'sliders-horizontal']].map(([page, label, glyph]) => `<button type="button" data-action="${page}" aria-pressed="${screen === page}" class="${page === 'add' ? 'll-nav-add' : ''}"><span>${icon(glyph)}</span><small>${e(t(label))}</small></button>`).join('')}</nav>`;}
  function modalView() {
    if (!modal) return '';
    const descriptions = {delete: ['删除这笔账目？', '删除后将同步更新统计与预算。', 'confirm-delete', '确认删除'], restore: ['恢复会替换全部账本。', store.failedToLoad ? '原始文件会保留副本。' : '恢复前会保留全部账本副本，可撤销这次恢复。', 'do-restore', '确认替换'], copy: ['用上月设置替换本月预算？', '其他月份的预算不受影响。', 'do-copy-budgets', '确认替换'], undo: ['撤销上次恢复', '回到恢复前的全部账本', 'do-undo-restore', '确认替换']};
    const [title, description, action, label] = descriptions[modal];
    return `<div class="ll-modal-shade"><section class="ll-modal" role="dialog" aria-modal="true" aria-labelledby="ll-dialog-title"><span class="ll-category-icon">${icon(modal === 'delete' ? 'trash-2' : 'archive-restore')}</span><h2 id="ll-dialog-title">${e(t(title))}</h2><p>${e(t(description))}</p><div>${button('close-modal', t('取消'), '', 'll-secondary')}${button(action, t(label), '', modal === 'delete' ? 'll-danger-button' : 'll-primary')}</div></section></div>`;
  }
  function render() {
    const views = {books: booksPage, 'book-edit': bookEditor, home, stats, year: annual, months, calendar, add: addPage, detail, budgets: budgetsPage, 'budget-edit': budgetForm, settings, currencies: currencySettings, 'currency-change': rebasePage, languages: languageSettings, categories: manageCategories, 'category-edit': categoryEditor, search, 'category-details': categoryDetails, 'restore-preview': restorePreview};
    const nav = ['home', 'stats', 'budgets', 'settings'].includes(screen);
    const animate = model.design.animations !== false && lastRenderedScreen !== null && lastRenderedScreen !== screen;
    const homeDate = selectedMonth + '/' + (selectedDay || '*');
    const animateDate = screen === 'home' && lastRenderedScreen === 'home' && lastHomeDate !== null && lastHomeDate !== homeDate && model.design.animations !== false && !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (screen === 'home') lastHomeDate = homeDate;
    lastRenderedScreen = screen;
    phone.innerHTML = `<main class="ll-content ${nav ? 'with-nav' : ''} ${animate ? 'll-enter' : ''}" data-screen="${screen}">${store.failedToLoad ? `<div class="ll-load-error" role="alert">${e(t('无法读取已有账目，请先保留原始数据。'))}</div>` : ''}${(views[screen] || home)()}</main>${nav ? navigation() : ''}<div class="ll-toast ${toast ? 'visible' : ''}" role="status" aria-live="polite">${toast ? icon('check-circle-2') : ''}<span>${e(t(toast))}</span></div><input type="file" class="ll-file-input" accept=".json,application/json" aria-label="${e(t('恢复备份'))}" hidden>${modalView()}${pickerView()}`;
    phone.setAttribute('lang', model.design.language === 'en' ? 'en' : model.design.language === 'ja' ? 'ja' : model.design.language === 'ko' ? 'ko' : 'zh-CN');
    phone.classList.toggle('ll-motion-off', model.design.animations === false);
    if (document.body.classList.contains('ll-native')) document.body.classList.toggle('ll-dialog-open', !!modal || !!picker);
    phone.querySelectorAll('button').forEach(button => button.classList.add('cursor-interaction'));
    applyDesign(); if (globalThis.lucide) lucide.createIcons({attrs: {width: 20, height: 20, 'stroke-width': 1.8}});
    clearTimeout(dateAnimationTimer);
    if (animateDate) {const list = phone.querySelector('.ll-ledger-list'), selected = phone.querySelector('.ll-week-strip [aria-pressed="true"]'); list?.classList.add('ll-date-enter'); selected?.classList.add('ll-date-selected'); dateAnimationTimer = setTimeout(() => {list?.classList.remove('ll-date-enter'); selected?.classList.remove('ll-date-selected');}, 170);}
    if (modal) phone.querySelector('.ll-modal button')?.focus();
    if (picker) phone.querySelector('.ll-picker-option[aria-pressed="true"]')?.focus({preventScroll:true});
    if (modal || picker) {phone.querySelector('main').inert = true; const navElement = phone.querySelector('nav'); if (navElement) navElement.inert = true;}
  }
  function applyDesign() {
    const palettes = {'鼠尾草绿': ['#506b50', '#e7eede', '#344e39'], '桃粉': ['#9f6571', '#f4e5e6', '#794351'], '淡紫': ['#7c6898', '#ede6f6', '#5e4d78']};
    const [accent, soft, deep] = palettes[model.design.palette]; phone.style.setProperty('--ll-accent', accent); phone.style.setProperty('--ll-soft', soft); phone.style.setProperty('--ll-deep', deep); phone.style.setProperty('--ll-radius', model.design.radius + 'px');
  }
  function go(next) {if (next !== screen) history.push(screen); if (next !== 'add') invalidateRate(); if (screen === 'currency-change' && next !== 'currency-change') stopRebase(); screen = next; listLimit = 80; error = ''; modal = null; picker = null; render(); scrollTop();}
  function mainPage(next) {if (next !== 'add') invalidateRate(); if (screen === 'currency-change' && next !== 'currency-change') stopRebase(); screen = next; history = []; listLimit = 80; error = ''; modal = null; picker = null; render(); scrollTop();}
  function scrollTop() {if (store.data) window.scrollTo({top: 0, behavior: 'instant'});}
  function goBack() {if (picker) {closePicker(); return true;} if (modal) {modal = null; render(); return true;} if (screen === 'home') return false; if (screen === 'currency-change') stopRebase(); screen = history.pop() || 'home'; if (screen !== 'add') invalidateRate(); error = ''; render(); scrollTop(); return true;}
  function showToast(message) {toast = message; clearTimeout(toastTimer); toastTimer = setTimeout(() => {toast = ''; const el = phone.querySelector('.ll-toast'); if (el) el.classList.remove('visible');}, 3300);}
  function playKoala(item) {
    clearTimeout(koalaTimer); clearTimeout(koalaBlinkTimer);
    const reactions = ['bounce', 'tilt', 'wave'];
    const choice = root.dataset.mascotReaction;
    const index = reactions.includes(choice) ? reactions.indexOf(choice) : koalaReaction++ % reactions.length;
    item.removeAttribute('data-reaction'); item.removeAttribute('data-eyes'); void item.offsetWidth;
    const reduced = model.design.animations === false || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    item.dataset.reaction = reduced ? 'hello' : reactions[index];
    if (!reduced) {item.dataset.eyes = 'closed'; koalaBlinkTimer = setTimeout(() => item.removeAttribute('data-eyes'), 160);}
    const reply = item.querySelector('.ll-koala-reply'); if (reply) reply.textContent = model.design.language === 'en' ? '+1' : model.design.language === 'ja' ? '＋1円' : model.design.language === 'ko' ? '＋1원' : '＋1元';
    koalaTimer = setTimeout(() => {item.removeAttribute('data-reaction'); item.removeAttribute('data-eyes'); if (reply) reply.textContent = '';}, 520);
  }
  function change(mutator, restoring = false) {
    if (store.failedToLoad && !restoring) {error = '无法读取已有账目，请先保留原始数据。'; return false;}
    commitActive(); const previous = C.clone(collection);
    try {mutator(); if (!restoring) commitActive(); collection = C.normalizeCollection(collection); bindBook(); const okay = restoring && store.restore ? store.restore(collection) : store.save(collection); if (okay === false) throw new Error('write_failed'); if (restoring) {store.failedToLoad = false; if (!store.restore) undoModel = previous;} return true;}
    catch (failure) {collection = previous; bindBook(); error = failure.message === 'last_category' ? '至少保留一个可用分类。' : '保存失败，请重试。'; return false;}
  }
  function syncWidget() {if (window.openai?.setWidgetState) window.openai.setWidgetState({modelContent: {palette: model.design.palette, roundedCorners: model.design.radius, mascot: model.design.mascot, language: model.design.language, mascotReaction: root.dataset.mascotReaction || 'cycle'}, privateContent: null}).catch(() => {});}
  function refreshClock() {try {const date = store.readToday?.(); if (date && date !== today) globalThis.ledgerRefreshToday(date);} catch {}}
  function returnToday() {refreshClock(); selectedMonth = currentMonth; selectedDay = today; trendDay = null; mainPage('home');}
  globalThis.ledgerGoBack = goBack;
  globalThis.ledgerRefreshToday = date => {if (!C.validDate(date) || date === today) return; const follow = selectedMonth === currentMonth && (!selectedDay || selectedDay === today); const followsDay = selectedDay === today; today = date; currentMonth = date.slice(0, 7); if (follow) {selectedMonth = currentMonth; if (followsDay) selectedDay = today;} render();};
  function saveRecord(again = false) {
    if (busy) return; const amount = C.calculate(draft.amount, draft.currency);
    if (!C.amountOK(amount)) {error = C.currencyInfo(draft.currency).digits ? '请输入大于 0 的有效金额。' : draft.currency === 'JPY' ? '请输入大于 0 的整数日元金额。' : '请输入大于 0 的整数金额。'; render(); return;}
    const rate = draft.currency === model.currency ? '1' : draft.rate.trim();
    if (!C.validRate(rate)) {error = '请输入有效汇率。'; render(); return;}
    const convertedAmount = C.convertAmount(amount, draft.currency, model.currency, rate);
    if (convertedAmount === null) {error = '金额或换算结果超出范围。'; render(); return;}
    if (!C.validDate(draft.date)) {error = '请选择有效日期。'; render(); return;}
    busy = true; const editing = editId !== null;
    try {
      let record = {id: editId || model.nextId, type: draft.type, category: draft.category, amount, currency: draft.currency, rate, convertedAmount, note: draft.note.trim(), date: draft.date};
      if (C.validDate(draft.rateDate)) record.rateDate = draft.rateDate;
      record = C.withValuations(record, model.currency, editing ? model.transactions.find(item => item.id === editId) : undefined);
      if (!change(() => {if (editing) model.transactions = model.transactions.map(item => item.id === editId ? record : item); else {model.transactions.push(record); model.nextId++;} model.design[draft.type === 'expense' ? 'lastExpenseCategory' : 'lastIncomeCategory'] = draft.category; model.design.lastCurrency = draft.currency; if (draft.currency !== model.currency && ['live', 'manual', 'cache'].includes(draft.rateSource) && (!model.exchangeRates[draft.currency] || draft.rateSource !== 'cache' || (draft.rateUpdatedAt || 0) > (model.exchangeRates[draft.currency].updatedAt || 0))) {model.exchangeRates[draft.currency] = {rate, updatedAt: draft.rateUpdatedAt || Date.now()}; if (record.rateDate) model.exchangeRates[draft.currency].date = record.rateDate;}})) {render(); return;}
      selectedMonth = draft.date.slice(0, 7); selectedDay = draft.date; showToast(editing ? '已修改' : '已保存'); error = ''; editId = null;
      if (again) {draft.amount = ''; draft.note = ''; render();} else {mainPage('home');}
    } finally {busy = false;}
  }
  function keypad(key) {
    error = '';
    if (key === 'clear') draft.amount = '';
    else if (key === 'backspace') draft.amount = draft.amount.slice(0, -1);
    else if (key === '=') {const value = C.calculate(draft.amount, draft.currency); if (value === null) error = '算式有误，或金额超出范围。'; else draft.amount = amountInput(value, draft.currency);}
    else if (key === '+' || key === '-') {if (draft.amount) draft.amount = draft.amount.replace(/[+-]$/, '') + key;}
    else if (key === '.') {const operand = draft.amount.split(/[+-]/).at(-1); if (C.currencyInfo(draft.currency).digits && !operand.includes('.')) draft.amount += operand ? '.' : '0.';}
    else if (draft.amount.length + key.length <= 32) draft.amount += key;
    const field = phone.querySelector('[name="amount"]'); if (field) field.value = draft.amount;
    const alert = phone.querySelector('.ll-error'); if (alert) alert.textContent = t(error);
    updateConversionPreview();
  }
  function editBudget(id) {budgetCategory = id || activeCats('expense')[0].id; budgetDraft = model.budgets[selectedMonth]?.[budgetCategory] ? amountInput(model.budgets[selectedMonth][budgetCategory]) : ''; go('budget-edit');}
  function imported(content) {try {pendingBackup = C.readCollectionBackup(content); go('restore-preview');} catch (failure) {error = failure.message === 'unsupported_backup' || failure.message === 'unsupported_format' ? '备份版本暂不支持。' : '文件不是有效的小小账本备份。'; render();}}
  globalThis.ledgerImportReady = imported;
  globalThis.ledgerFileResult = result => {if (result.status === 'success') showToast('文件已保存'); else if (result.status !== 'cancelled') error = '无法保存或读取文件，请重试。'; render();};
  function exportFile(kind) {
    if (store.failedToLoad) {error = '无法读取已有账目，请先保留原始数据。'; render(); return;}
    const payload = kind === 'backup' ? (commitActive(), C.collectionBackup(collection)) : C.csv(model);
    if (store.export) {store.export(kind, payload); return;}
    const url = URL.createObjectURL(new Blob([payload], {type: kind === 'backup' ? 'application/json' : 'text/csv;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url; link.download = `${model.design.language === 'en' ? 'Little-Ledger' : '小小账本'}-${kind === 'backup' ? 'backup' : 'entries'}-${today}.${kind === 'backup' ? 'json' : 'csv'}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  phone.addEventListener('input', event => {
    const input = event.target;
    if (input.name === 'rebase-rate' && rebaseDraft?.quotes[input.dataset.currency]) {
      const currency = input.dataset.currency, quote = rebaseDraft.quotes[currency]; quote.rate = input.value; quote.date = ''; quote.updatedAt = Date.now(); quote.source = 'manual'; quote.failed = false; quote.loading = false; quote.revision++;
      if (rebaseRequest?.currency === currency) {clearTimeout(rebaseTimer); rebaseRequest = null;}
      updateRebasePreview(); advanceRebaseQueue();
    }
    if (input.name === 'amount') {draft.amount = input.value; updateConversionPreview();}
    if (input.name === 'exchange-rate') {draft.rate = input.value; draft.rateDate = ''; draft.rateUpdatedAt = Date.now(); draft.rateSource = 'manual'; draft.rateFailed = false; invalidateRate(); updateConversionPreview(); const meta = phone.querySelector('.ll-rate-meta > span'); if (meta) meta.textContent = t('手动汇率'); const refresh = phone.querySelector('[data-action="refresh-rate"]'); if (refresh) refresh.disabled = false; const warning = phone.querySelector('.ll-rate-error'); if (warning) warning.remove();}
    if (input.name === 'note') draft.note = input.value;
    if (input.name === 'budget') budgetDraft = input.value;
    if (input.name === 'category-zh') categoryDraft.nameZh = input.value;
    if (input.name === 'category-ja') categoryDraft.nameJa = input.value;
    if (input.name === 'category-ko') categoryDraft.nameKo = input.value;
    if (input.name === 'category-en') categoryDraft.nameEn = input.value;
    if (input.name === 'book-name') bookNameDraft = input.value;
    if (input.name === 'query') {query = input.value; listLimit = 80; const focused = input.selectionStart; render(); const next = phone.querySelector('[name="query"]'); next.focus(); try {next.setSelectionRange(focused, focused);} catch {}}
  });
  phone.addEventListener('focusin', event => {if (event.target.name === 'note') phone.classList.add('ll-note-focus');});
  phone.addEventListener('focusout', event => {if (event.target.name === 'note') phone.classList.remove('ll-note-focus');});
  phone.addEventListener('change', event => {
    const input = event.target;
    if (input.name === 'entry-date') {draft.date = input.value; render();}
    if (input.name === 'entry-currency' && C.CURRENCIES.includes(input.value)) {prepareCurrency(input.value); render(); if (draft.currency !== model.currency) requestDraftRate();}
    if (input.name === 'filter-date' && C.validDate(input.value)) {selectedDay = input.value; selectedMonth = input.value.slice(0, 7); mainPage('home');}
    if (input.name === 'budget-category') {budgetCategory = input.value; budgetDraft = model.budgets[selectedMonth]?.[budgetCategory] ? amountInput(model.budgets[selectedMonth][budgetCategory]) : ''; render();}
    if (input.name === 'view-year') {const value = Number(input.value); if (Number.isInteger(value) && value >= 1 && value <= 9999) {viewYear = value; render();}}
    if (input.type === 'file' && input.files?.[0]) {if (input.files[0].size > 20000000) {error = '文件不是有效的小小账本备份。'; render(); return;} const reader = new FileReader(); reader.onload = () => imported(reader.result); reader.onerror = () => {error = '无法保存或读取文件，请重试。'; render();}; reader.readAsText(input.files[0]);}
  });
  phone.addEventListener('keydown', event => {if (picker) {if (event.key === 'Escape') {event.preventDefault(); closePicker(); return;} if (event.key === 'Tab') {const items = [...phone.querySelectorAll('.ll-picker button')]; const index = items.indexOf(document.activeElement), next = (index + (event.shiftKey ? -1 : 1) + items.length) % items.length; event.preventDefault(); items[next]?.focus();} return;} if (event.key === 'Escape' && modal) {modal = null; render();} if (event.key === 'Enter' && event.target.name === 'amount') {event.preventDefault(); saveRecord();}});
  phone.addEventListener('click', event => {
    if (event.target.classList.contains('ll-picker-shade')) {closePicker(); return;}
    const chart = event.target.closest('[data-trend-chart]'); if (chart) {const bounds = chart.getBoundingClientRect(); const day = Math.min(C.monthLength(selectedMonth), Math.max(1, Math.floor((event.clientX - bounds.left) / bounds.width * C.monthLength(selectedMonth)) + 1)); trendDay = selectedMonth + '-' + String(day).padStart(2, '0'); render(); return;}
    const item = event.target.closest('button'); if (!item || item.disabled) return; const data = item.dataset; error = '';
    if (data.pickCurrency && C.CURRENCIES.includes(data.pickCurrency)) {prepareCurrency(data.pickCurrency); closePicker(); if (draft.currency !== model.currency) requestDraftRate(); return;}
    if (data.pickBudgetCategory) {budgetCategory = data.pickBudgetCategory; budgetDraft = model.budgets[selectedMonth]?.[budgetCategory] ? amountInput(model.budgets[selectedMonth][budgetCategory]) : ''; closePicker(); return;}
    if (data.switchBook) {if (change(() => {collection.activeBookId = data.switchBook; bindBook();})) {invalidateRate(); stopRebase(); draft = {}; editId = detailId = null; query = ''; trendDay = null; showToast('账本已切换'); mainPage('home');} else render(); return;}
    if (data.editBook) {editingBookId = data.editBook; bookNameDraft = bookName(collection.books.find(book => book.id === editingBookId)); go('book-edit'); return;}
    if (data.key) {keypad(data.key); return;}
    if (data.moveMonth) {selectedMonth = C.moveMonth(selectedMonth, Number(data.moveMonth)); selectedDay = null; trendDay = null; render(); return;}
    if (data.moveYear) {viewYear = Math.min(9999, Math.max(1, viewYear + Number(data.moveYear))); render(); return;}
    if (data.viewMonth) {selectedMonth = data.viewMonth; selectedDay = null; trendDay = null; mainPage(monthOrigin); return;}
    if (data.selectDay) {selectedDay = data.selectDay; selectedMonth = selectedDay.slice(0, 7); mainPage('home'); return;}
    if (data.detail) {detailId = Number(data.detail); go('detail'); return;}
    if (data.type) {draft.type = data.type; draft.category = activeCats(draft.type).find(category => category.id === model.design[draft.type === 'expense' ? 'lastExpenseCategory' : 'lastIncomeCategory'])?.id || activeCats(draft.type)[0].id; render(); return;}
    if (data.category) {draft.category = data.category; render(); return;}
    if (data.statType) {statType = data.statType; trendDay = null; render(); return;}
    if (data.categoryType) {categoryType = data.categoryType; render(); return;}
    if (data.budgetCategory) {editBudget(data.budgetCategory); return;}
    if (data.filterCategory) {filterCategory = data.filterCategory; go('category-details'); return;}
    if (data.editCategory) {categoryDraft = {...cat(data.editCategory), existing: true}; go('category-edit'); return;}
    if (data.icon) {categoryDraft.icon = data.icon; render(); return;}
    if (data.color) {categoryDraft.color = data.color; render(); return;}
    if (data.baseCurrency) {beginRebase(data.baseCurrency); return;}
    if (data.language && ['zh', 'ja', 'ko', 'en'].includes(data.language)) {if (change(() => {model.design.language = data.language;})) {syncWidget(); goBack();} else render(); return;}
    if (data.refreshRebase) {requestRebaseQuote(data.refreshRebase); return;}
    if (data.archiveCategory) {if (change(() => {const category = cat(data.archiveCategory); category.archived = !category.archived;})) showToast('分类已更新'); render(); return;}
    if (data.orderCategory) {change(() => {const ids = model.categories.filter(category => category.type === categoryType).map(category => category.id); const from = ids.indexOf(data.orderCategory), target = from + Number(data.direction); if (target >= 0 && target < ids.length) {const a = model.categories.findIndex(category => category.id === ids[from]), b = model.categories.findIndex(category => category.id === ids[target]); [model.categories[a], model.categories[b]] = [model.categories[b], model.categories[a]];}}); render(); return;}
    const action = data.action;
    if (action === 'pick-entry-currency' || action === 'pick-budget-category') {pickerReturnFocus = action; picker = action === 'pick-entry-currency' ? 'currency' : 'budget-category'; render(); return;}
    if (action === 'close-picker') {closePicker(); return;}
    if (action === 'books') {go('books'); return;}
    if (action === 'book-new') {editingBookId = null; bookNameDraft = ''; go('book-edit'); return;}
    if (action === 'save-book') {const clean = bookNameDraft.trim(); if (!clean) error = '请填写账本名称。'; else if (clean.length > 40) error = '账本名称不能超过40个字符。'; else if (collection.books.some(book => book.id !== editingBookId && bookName(book).trim().toLowerCase() === clean.toLowerCase())) error = '已经有同名账本。'; else if (!editingBookId && collection.books.length >= 50) error = '账本数量已达上限。'; else if (change(() => {if (editingBookId) C.renameBook(collection, editingBookId, clean); else {C.createBook(collection, clean); bindBook();}})) {showToast(editingBookId ? '账本已更新' : '账本已创建'); mainPage(editingBookId ? 'books' : 'home'); return;} render(); return;}
    if (action === 'koala') {playKoala(item); return;}
    if (action === 'refresh-rate') {requestDraftRate(); return;}
    if (action === 'refresh-rebase-all' && rebaseDraft) {if (rebaseRequest) {clearTimeout(rebaseTimer); rebaseDraft.quotes[rebaseRequest.currency].loading = false; rebaseRequest = null;} rebaseDraft.queue = [...rebaseDraft.plan.currencies]; advanceRebaseQueue(); return;}
    if (action === 'confirm-rebase' && rebaseDraft) {if (!rebasePreviewResult().ready) {updateRebasePreview(); return;} const target = rebaseDraft.target, quotes = rebaseQuotes(), resetLastCurrency = rebaseDraft.plan.transactionCount === 0 && rebaseDraft.plan.budgetCount === 0; if (change(() => {model = C.rebaseCurrency(model, target, quotes); if (resetLastCurrency) model.design.lastCurrency = target;})) {showToast('主货币已更新'); goBack();} else render(); return;}
    if (action === 'currencies') {go('currencies'); return;}
    if (action === 'toggle-motion') {if (change(() => {model.design.animations = !model.design.animations;})) showToast('动画已更新'); render(); return;}
    if (action === 'more-records') {listLimit += 80; render(); return;}
    if (['home', 'stats', 'budgets', 'settings'].includes(action)) {mainPage(action); return;}
    if (action === 'back') {goBack(); return;}
    if (action === 'today') {returnToday(); return;}
    if (action === 'this-year') {viewYear = Number(today.slice(0, 4)); render(); return;}
    if (action === 'months') {monthOrigin = ['home', 'stats', 'budgets', 'calendar'].includes(screen) ? screen : 'home'; viewYear = Number(selectedMonth.slice(0, 4)); go('months'); return;}
    if (action === 'year') {viewYear = Number(selectedMonth.slice(0, 4)); monthOrigin = 'home'; go('year'); return;}
    if (action === 'calendar') {go('calendar'); return;}
    if (action === 'all-month') {selectedDay = null; render(); return;}
    if (action === 'add') {startAdd(); return;}
    if (action === 'draft-today') {refreshClock(); draft.date = today; render(); return;}
    if (action === 'save-record' || action === 'save-next') {saveRecord(action === 'save-next'); return;}
    if (action === 'edit') {const record = model.transactions.find(item => item.id === detailId); if (record) {invalidateRate(); draft = {...record, amount: amountInput(record.amount, record.currency), rateDate: record.rateDate || '', rateSource: 'record', rateLoading: false, rateFailed: false}; editId = record.id; go('add');} return;}
    if (action === 'delete') modal = 'delete';
    if (action === 'close-modal') modal = null;
    if (action === 'confirm-delete') {if (change(() => {model.transactions = model.transactions.filter(item => item.id !== detailId);})) {showToast('已删除'); mainPage('home'); return;} modal = null;}
    if (action === 'budget-new') {editBudget(); return;}
    if (action === 'save-budget') {const value = C.parseAmount(budgetDraft.trim(), model.currency); if (!C.amountOK(value)) error = model.currency === 'JPY' ? '请输入大于 0 的整数日元金额。' : '请输入大于 0 的有效金额。'; else if (change(() => {C.setBudget(model, selectedMonth, budgetCategory, value);} )) {showToast('预算已更新'); mainPage('budgets'); return;}}
    if (action === 'remove-budget') {if (change(() => {C.deleteBudget(model, selectedMonth, budgetCategory);} )) {showToast('预算已更新'); mainPage('budgets'); return;}}
    if (action === 'copy-budgets') modal = 'copy';
    if (action === 'do-copy-budgets') {if (change(() => {C.copyBudgets(model, C.moveMonth(selectedMonth, -1), selectedMonth);})){showToast('预算已更新'); modal = null;} else modal = null;}
    if (action === 'language') {go('languages'); return;}
    if (action === 'manage-categories') {categoryType = screen === 'add' ? draft.type : 'expense'; go('categories'); return;}
    if (action === 'category-new') {categoryDraft = {id: 'custom-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8), type: categoryType, nameZh: '', nameJa: '', nameKo: '', nameEn: '', icon: 'leaf', color: 'sage', archived: false, existing: false}; go('category-edit'); return;}
    if (action === 'save-category') {
      const en = (categoryDraft.nameEn || '').trim(), zh = categoryDraft.nameZh.trim() || en, ja = categoryDraft.nameJa.trim(), ko = (categoryDraft.nameKo || '').trim();
      if (!zh) error = '请填写分类名称。'; else if (model.categories.some(category => category.type === categoryDraft.type && category.id !== categoryDraft.id && (category.nameZh === zh || (ja && category.nameJa === ja) || (ko && category.nameKo === ko) || (en && category.nameEn === en)))) error = '同类型中已有这个分类名称。';
      else if (change(() => {const value = {id: categoryDraft.id, type: categoryDraft.type, nameZh: zh, nameJa: ja, nameKo: ko, nameEn: en, icon: categoryDraft.icon, color: categoryDraft.color, archived: categoryDraft.archived}; if (categoryDraft.existing) model.categories = model.categories.map(category => category.id === value.id ? value : category); else model.categories.push(value);})){showToast('分类已更新'); goBack(); return;}
    }
    if (action === 'search') {query = ''; go('search'); return;}
    if (action === 'export-backup') {exportFile('backup'); return;}
    if (action === 'export-csv') {exportFile('csv'); return;}
    if (action === 'import-backup') {if (store.import) store.import(); else phone.querySelector('.ll-file-input').click(); return;}
    if (action === 'restore-confirm') modal = 'restore';
    if (action === 'do-restore') {if (pendingBackup && change(() => {collection = C.clone(pendingBackup.data); bindBook();}, true)) {pendingBackup = null; selectedMonth = currentMonth; selectedDay = null; showToast('恢复已完成'); mainPage('settings'); return;} modal = null;}
    if (action === 'undo-restore') modal = 'undo';
    if (action === 'do-undo-restore') {
      try {if (store.undo) {const previous = store.undo(); collection = C.normalizeCollection(typeof previous === 'string' ? JSON.parse(previous) : previous); bindBook();} else {const previous = undoModel; if (!previous || store.save(previous) === false) throw new Error('undo_failed'); collection = C.normalizeCollection(previous); bindBook(); undoModel = null;} store.failedToLoad = false; selectedMonth = currentMonth; selectedDay = null; showToast('已撤销恢复'); mainPage('settings'); return;} catch {error = '保存失败，请重试。'; modal = null;}
    }
    render();
  });
  const saved = window.openai?.widgetState?.modelContent;
  function applySaved(state) {if (!state) return; if (['鼠尾草绿', '桃粉', '淡紫'].includes(state.palette)) model.design.palette = state.palette; if (['zh', 'ja', 'ko', 'en'].includes(state.language)) model.design.language = state.language; if (Number.isFinite(state.roundedCorners)) model.design.radius = Math.min(30, Math.max(12, state.roundedCorners)); if (typeof state.mascot === 'boolean') model.design.mascot = state.mascot; if (['cycle', 'bounce', 'tilt', 'wave'].includes(state.mascotReaction)) root.dataset.mascotReaction = state.mascotReaction;}
  applySaved(saved);
  window.addEventListener('openai:set_globals', event => {applySaved(event.detail?.globals?.widgetState?.modelContent); render();});
  render();
  if (globalThis.Tweak) {
    const controls = {palette: model.design.palette, radius: model.design.radius, mascot: model.design.mascot, reaction: root.dataset.mascotReaction || 'cycle'};
    const tweak = new Tweak({container: root, onChange: () => {model.design.palette = controls.palette; model.design.radius = controls.radius; model.design.mascot = controls.mascot; root.dataset.mascotReaction = controls.reaction; render(); syncWidget();}});
    tweak.addSelect(controls, 'palette', {label: '主题配色', options: ['鼠尾草绿', '桃粉', '淡紫']});
    tweak.addSlider(controls, 'radius', {label: '卡片圆角', min: 16, max: 30, step: 2, unit: 'px'});
    tweak.addToggle(controls, 'mascot', {label: '考拉装饰'});
    tweak.addSelect(controls, 'reaction', {label: '考拉动作', options: [{label: '轮流回应', value: 'cycle'}, {label: '轻轻弹一下', value: 'bounce'}, {label: '歪头', value: 'tilt'}, {label: '挥手', value: 'wave'}]});
  }
})();
