import type { Dict } from '../types.ts';
import type { Pack } from '../landing.generic.ts';

export const dict: Dict = {
  site: { name: 'LocalConvert', tagline: '从不上传文件的转换工具', description: '在浏览器中转换 HEIC、JPG、PNG、WebP、AVIF、PDF 和 Excel。不上传、无广告、无需注册。' },
  nav: { tools: '工具', privacy: '隐私', language: '语言', command: '命令', theme: '切换主题', admin: '管理', skip: '跳到正文' },
  hero: { kicker: '免费 · 不上传 · 无需注册', title: '转换文件，不发送到任何地方。', sub: '照片、PDF 和表格都在这个浏览器标签页里转换。文件留在你的设备上——快速、私密、免费。', drop: '把文件拖到这里，或点击选择', dropHint: '可一次多个 · 按 Ctrl+V 粘贴截图', dropOver: '松开即可添加', demoCaption: '本站的真实转换结果', before: '原图', after: '转换后' },
  history: { title: '最近的转换', empty: '还没有。', note: (d: number) => `只保存在这台设备的浏览器中，${d} 天后删除。`, download: '下载', remove: '删除', clear: '全部删除', keep: '保留记录' },
  scenes: {
    popular: '常用转换',
    search: { title: '智能压缩如何找到大小', sub: '满足画质目标的最小文件，平均约 2~4 次。', quality: '画质', target: '目标', size: '文件大小', steps: ['根据类似照片的统计先猜一个', '沿斜率跳到目标另一侧', '插值缩小范围', '达标中最小的文件'], over: '超过目标，仍偏大', under: '不足', pass: '达标 — 选用' },
    parallel: { title: '同时处理多个文件', sub: '每个 CPU 核心一个工作进程，只在内存允许的范围内并行。', worker: '工作进程', zip: '打包成一个 ZIP' },
    formats: { title: '从这些格式到那些格式', sub: (n: number) => `图中 ${n} 种转换都在你的设备上完成。`, inputs: '输入', outputs: '输出' },
  },
  proof: { noUpload: '不上传任何内容', noUploadBody: '转换在你的设备上完成。浏览器本身会拦截任何把文件发往其他服务器的请求。', noAds: '无广告、无账号', noAdsBody: '没有弹窗，没有排队，大文件也不需要付费。', parallel: '批量并行处理', parallelBody: '一次放入一百张照片，会在多个 CPU 核心上同时处理，并打包成一个 ZIP。' },
  quick: {
    convert: { title: '转换图片格式', desc: 'HEIC、PSD、SVG → JPG、PNG、WebP、AVIF' }, compress: { title: '压缩照片', desc: '看起来一样的最小文件' },
    pdf: { title: '合并和拆分 PDF', desc: '调整顺序、合并、提取页面' }, pdfCompress: { title: '压缩 PDF', desc: '让扫描件小到能用邮件发送' },
    imageToPdf: { title: '照片 → PDF', desc: '多张照片合成一个 PDF' }, data: { title: 'Excel ↔ CSV · JSON', desc: '不乱码、不丢开头的 0' },
  },
  actions: {
    convert: { label: '转换格式', desc: '转为 JPG、PNG、WebP 或 AVIF，也能打开 HEIC、PSD 和 SVG。' }, compress: { label: '压缩', desc: '自动找到看起来与原图一样的最小文件。' },
    'image-to-pdf': { label: '生成 PDF', desc: '把照片合成一个 PDF。JPG 原样嵌入，不再压缩。' }, 'pdf-merge': { label: '合并 PDF', desc: '按列表顺序合并，可拖动调整顺序。' },
    'pdf-compress': { label: '压缩 PDF', desc: '重新压缩其中的照片，文字保持清晰。' }, 'pdf-to-image': { label: 'PDF → 图片', desc: '每页一张图片。' },
    'pdf-split': { label: '拆分 PDF', desc: '每页一个文件，或按你给的范围拆分。' }, data: { label: '转换数据', desc: 'Excel、CSV、JSON、YAML。保留开头的 0 和中文。' }, ocr: { label: '提取文字(OCR)', desc: '把照片或截图中的韩文、英文读成 .txt。首次使用会下载语言数据(4.5MB)。' }, video: { label: '转换视频', desc: '把 MP4、MOV、WebM 转为 MP4、WebM、GIF，或只保存音频（M4A）。使用浏览器自带的编解码器（新版 Chrome、Edge、Firefox）。GIF 仅限 30 秒以内，选择原始尺寸时生成 360p。' },
  },
  fields: { to: '保存为', width: '宽度', quality: '画质', target: '画质标准', pageSize: '页面', pdfQuality: '压缩', dpi: '分辨率', pages: '页面', ranges: '拆分范围', original: '原始尺寸', small: '小', high: '高', normal: '普通', auto: '自动', nearOriginal: '接近原图', balanced: '均衡', smallest: '最小', fitPhoto: '照片尺寸', light: '轻', strong: '强', screen: '屏幕', print: '打印', allPagesHint: '全部（如 1-3,5）', splitHint: '留空=每页一个（如 1-3,4-6）', videoSize: '画面尺寸', gifFps: 'GIF 每秒帧数', audioOnly: '仅音频（M4A）' },
  ui: {
    audioDropped: '此浏览器无法转换音频，已保存为无声视频', status: (done, total, failed) => `共 ${total} 个，已完成 ${done} 个${failed ? `，${failed} 个失败` : ''}`,
    files: '文件', clear: '清空', addMore: '+ 添加更多文件', run: (l, n) => `${l}（${n} 个）`, runCombined: l => l, cancel: '取消', saveAll: n => `全部下载（${n}）`, save: '下载', startOver: '重新开始', remaining: n => `转换剩余 ${n} 个`,
    processing: '处理中…', tries: (q, n) => `画质 ${q} · 尝试 ${n} 次`, tooLarge: (need, limit) => `需要约 ${need}，此设备上限约 ${limit}。请选择更小的尺寸，或在电脑上打开。`, keptOriginal: '已经足够小，保留原文件', color444: '为保持颜色边缘清晰，未做色度抽样(4:4:4)', colorWarn: 'WebP 可能使彩色文字和细彩色线条模糊，建议使用 AVIF 或 PNG', filesN: n => `${n} 个文件`, notForThis: '不适用于此工具',
    skipped: n => `${n} 个文件不适用于此工具，将跳过。`, skippedUnsupported: n => `已跳过 ${n} 个不支持的文件`, pasted: '已添加粘贴的文件', done: '完成！', doneDownload: '完成！请下载文件', zipping: '正在打包 ZIP…',
    noActions: '这些文件没有可执行的操作。', compare: '对比', fit: '适应', actualSize: '100%', close: '关闭', up: '上移', down: '下移', download: '下载', remove: '移除',
    paletteHint: '要做什么？', paletteEmpty: '没有匹配的命令', telemetryOff: '关闭匿名统计', telemetryOn: '开启匿名统计', telemetryOffDone: '已关闭统计', telemetryOnDone: '已开启统计', themeCycle: '主题：自动 · 浅色 · 深色',
    pages: n => `${n} 页`, psdNote: '此 PSD 没有合成图像，已在此合并图层。图层效果可能缺失。', moveUp: '上移',
    footer: '无广告 · 无需注册 · 不上传 · 匿名使用统计（仅格式、大小和耗时）', footerToggleOff: '关闭', footerToggleOn: '开启', licenses: '开源许可',
  },
  reasons: { noWebcodecs: '此浏览器不支持视频转换（WebCodecs）。请在最新版 Chrome、Edge 或 Firefox 中打开。', noVideo: '此文件没有视频画面。请选择仅保存音频（M4A）。', noAudio: '此视频没有声音。', encoderMp4: '此浏览器无法保存 MP4（H.264）。请选择 WebM。', encoderWebm: '此浏览器无法保存 WebM（VP9）。请选择 MP4。', videoCodec: n => `此浏览器无法打开 ${n} 视频。请换用其他浏览器（Chrome、Edge 或 Safari）。`, audioCodec: '此浏览器无法转换该视频的声音。', gifSeconds: n => `GIF 仅支持 30 秒以内的视频（此视频 ${n} 秒）。请保存为 MP4 或 WebM。`, gifPixels: '画面太大或时长太长，无法制作 GIF。请选择更小的尺寸或更低的帧率。' },
  errors: { unsupported: '这里不支持该文件类型。', decode: '无法打开文件。文件可能已损坏，或与文件名的格式不符。', encode: '无法保存为该格式。', 'too-large': '文件对这台设备来说太大了。', 'out-of-memory': '设备内存不足。请缩小尺寸或分几次处理。', 'worker-crash': '转换器意外停止，请重试。', timeout: '耗时过长，已停止。', cancelled: '已取消', password: '该 PDF 受密码保护。', unknown: '转换时出了点问题。' },
  privacy: { title: '我的文件去哪了？', body: ['哪儿也没去。页面只下载一次转换程序，之后文件只在浏览器内部读写。', '安全响应头（Content-Security-Policy）让浏览器拒绝连接其他服务器，所以即使有程序错误，文件也无法外传。', '为了发现问题，我们只收集匿名计数——使用的工具、文件类型、大小区间和耗时。没有文件名、内容或个人信息，可在下方关闭。'] },
  faqTitle: '常见问题', related: '相关工具', howTo: '使用方法',
};

export const pack: Pack = {
  name: { heic: 'HEIC', jpg: 'JPG', png: 'PNG', webp: 'WebP', avif: 'AVIF', psd: 'PSD', svg: 'SVG', pdf: 'PDF', xlsx: 'Excel（XLSX）', csv: 'CSV', json: 'JSON', yaml: 'YAML' },
  facts: {
    heic: 'HEIC 是 iPhone 默认保存照片的格式，很多 Windows 软件和网站仍无法打开。', jpg: 'JPG 是兼容性最好的照片格式，任何手机、浏览器和办公软件都能打开。',
    png: 'PNG 无损并支持透明，适合截图和标志，但保存照片时体积较大。', webp: 'WebP 是现代网页格式，相近画质下照片通常比 JPG 小 25–35%。',
    avif: 'AVIF 是最新的主流图片格式，通常体积最小，但部分旧软件无法打开。', psd: 'PSD 是 Photoshop 文档格式。LocalConvert 读取其合成图像；若文件未保存合成图像，则合并可见图层。',
    svg: 'SVG 是矢量格式。转为 PNG 后以固定尺寸绘制，可在任何接受图片的地方使用。', pdf: 'PDF 能在任何设备上保持文档的原始排版。',
    xlsx: 'XLSX 是 Microsoft Excel 的工作簿格式。', csv: 'CSV 是用逗号分隔值的纯文本，几乎所有软件都能导入。', json: 'JSON 是 Web API 的标准数据格式。', yaml: 'YAML 是易读的数据格式，常用于配置文件。',
  },
  privacy: { q: '文件会上传到服务器吗？', a: '不会。转换在浏览器标签页里进行，网站的安全策略会阻止连接其他服务器，文件无法离开你的设备。' },
  cost: { q: '免费吗？有大小限制吗？', a: '免费，无需账号，没有广告。没有固定上限，超大文件取决于设备内存，太大时页面会提示。' },
  mobile: { q: 'iPhone 和安卓能用吗？', a: '能，在 Safari、Chrome、三星浏览器等现代浏览器中都可以。安卓还可以通过分享菜单把文件发给已安装的应用（iPhone 不支持此功能）。' },
  convert: {
    title: (f, t) => `${f} 转 ${t} — 免费、不上传`, meta: (f, t) => `在浏览器中把 ${f} 转为 ${t}。文件不离开设备，无需注册、无广告，可批量转换并打包成一个 ZIP。`,
    tail: (f, t) => `把 ${f} 文件放到下方，即可在这里直接转为 ${t}。`, steps: (f, t) => [`拖入或选择 ${f} 文件（可一次多个）。`, `已选好 ${t}，如有需要可调小宽度或画质。`, '转换后逐个下载，或打包成 ZIP 一次下载。'],
    lossless: { q: '会损失画质吗？', a: 'PNG 是无损格式，转换本身不会降低画质。' }, lossy: t => ({ q: `转成 ${t} 会损失画质吗？`, a: `${t} 是压缩格式。默认画质设定为看起来与原图一致；如需更高可选“高”。` }),
    orientation: { q: '照片方向会保留吗？', a: '会。照片中记录的旋转信息会被应用，位置信息（GPS）不会复制到新文件。' },
  },
  compress: {
    title: f => `压缩${f ?? '图片'} — 看起来一样的最小体积`, meta: f => `在不明显损失画质的情况下减小${f ?? '图片'}体积。LocalConvert 通过测量相似度（SSIM）自动找到最小文件，在浏览器中完成，不上传。`,
    intro: 'LocalConvert 不靠猜画质数值，而是尝试几种设置，用 SSIM 测量每个结果与原图的接近程度，保留达标中最小的一个。通常 3–4 次就能找到。', pngNote: 'PNG 照片会保存为 WebP，通常小好几倍。',
    steps: ['放入图片。', '选择标准：接近原图、均衡或最小。', '下载结果；本来就够小的文件保持不变。'],
    howMuch: { q: '能小多少？', a: '因照片而异。测试中一张 220 KB 的 JPG 在“均衡”下变为 130 KB（−41%），看不出差别。' }, batch: { q: '能一次压缩很多张吗？', a: '能。批量任务在多个 CPU 核心上并行处理，并打包成一个 ZIP 下载。' },
  },
  resize: { title: '调整图片尺寸 — 免费，在浏览器中', meta: '为邮件、社交平台或网页缩小照片像素。高质量 Lanczos 缩放，不上传、无需注册。', intro: '选择目标宽度（4K、全高清、社交平台或小图），照片使用高质量 Lanczos 滤镜缩小；超大照片会直接以较小尺寸解码，即使 5000 万像素也能装进内存。', steps: ['放入图片。', '选择宽度和格式。', '下载缩小后的图片或 ZIP。'], ratio: { q: '会保持比例吗？', a: '会。只缩小，不拉伸也不放大。' } },
  merge: { title: '合并 PDF — 免费、不上传', meta: '在浏览器中把多个 PDF（和图片）合并成一个。拖动调整顺序，页面不会重新压缩。', intro: '页面原样复制，文字保持清晰且不会重新压缩。可以混合 PDF 和照片，每张照片成为一页。', steps: ['放入两个或更多 PDF。', '拖动或用箭头调整顺序。', '合并并下载一个 PDF。'], encrypted: { q: '能合并有密码的 PDF 吗？', a: '暂时不能。加密的 PDF 会被识别并提示，而不是生成损坏的文件。' } },
  split: { title: '拆分 PDF — 免费提取页面', meta: '在浏览器中把 PDF 拆成单页或 1-3,5,8- 这样的范围。不上传。', intro: '范围留空则每页一个文件；也可以输入 1-3、4-6 或 8-（到最后）这样的范围。', steps: ['放入一个 PDF。', '输入页面范围或留空。', '打包成 ZIP 下载。'], quality: { q: '拆分会降低画质吗？', a: '不会。页面直接复制，不会重新编码。' } },
  compressPdf: { title: '压缩 PDF — 让扫描件小到能用邮件发送', meta: '只重新压缩 PDF 中的照片来减小体积，文字保持清晰。在浏览器中完成，不上传。', intro: '扫描文件大多是照片。LocalConvert 并行地重新压缩并缩小这些图片，不改动文字和矢量图形。测试中 1.9 MB 的扫描件变为 0.46 MB（−76%）。', steps: ['放入一个 PDF。', '选择轻、普通或强压缩。', '下载变小的 PDF；若没有变小则保留原文件。'], blurry: { q: '文字会变模糊吗？', a: '不会。只重新压缩其中的照片，文字仍是文字。' }, which: { q: '哪些 PDF 缩小得最多？', a: '扫描件和含大照片的 PDF。纯文字 PDF 通常本来就很小。' } },
  pdfToImage: { title: t => `PDF 转 ${t} — 每页一张图片`, meta: t => `在浏览器中把 PDF 页面转为屏幕或打印分辨率的 ${t} 图片，可选择 1-3,5 这样的页面。不上传。`, intro: t => `使用 Mozilla 的 PDF 引擎（pdf.js）以 96、150 或 300 DPI 渲染每一页，并保存为 ${t}。`, steps: t => ['放入一个 PDF。', '选择分辨率，按需选择页面。', `打包下载 ${t} 文件。`], dpi: { q: '该选什么分辨率？', a: '屏幕查看和大多数文档用 150 DPI，打印用 300 DPI。' } },
  imagesToPdf: { title: 'JPG 转 PDF — 多张照片合成一个 PDF', meta: '在浏览器中把照片合成一个 PDF。JPG 不再压缩，画质不变。不上传。', intro: 'JPG 按原始字节放入 PDF，没有画质损失。页面可选照片尺寸或带边距的 A4。iPhone 的 HEIC 照片也可以。', steps: ['放入照片。', '排好顺序并选择页面大小。', '下载一个 PDF。'], blurry: { q: 'PDF 会变模糊吗？', a: '不会。JPG 原样放入，其他格式以高画质转换后放入。' } },
  data: { title: (f, t) => `${f} 转 ${t} — 不乱码、不丢开头的 0`, meta: (f, t) => `在浏览器中把 ${f} 转为 ${t}。自动识别文字编码，保留以 0 开头的电话号码和编号。不上传。`, tail: '像 007 这样的值会保留为文本而不会变成数字，Excel 用其他编码（如 GBK）保存的 CSV 也会自动识别。', steps: (f, t) => [`放入 ${f} 文件。`, `已选好 ${t}。`, '下载转换后的文件。'], excel: { q: 'Excel 打开 CSV 会乱码吗？', a: '不会。CSV 会带 UTF-8 标记（BOM）保存，Excel 能正确显示中文。' }, nested: { q: '嵌套的 JSON 怎么办？', a: '转成表格时，嵌套对象会变成 address.city 这样用点连接的列名。' } },
};
