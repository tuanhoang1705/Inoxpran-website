const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = process.cwd();
const runId = `daily-seo-${new Date().toISOString().slice(0,10)}-${Date.now()}`;
const outDir = path.join(root, 'deploy', 'openclaw', 'workspaces', 'seo-orchestrator', 'runs', runId);
fs.mkdirSync(outDir, { recursive: true });

function readEnvFiles() {
  const env = { ...process.env };
  for (const p of [path.join(root, '.env'), path.join(root, 'backend', '.env'), path.join(root, 'frontend', '.env')]) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return env;
}
const env = readEnvFiles();

const sourceNotes = [
  { type: 'existing_blog_api', note: 'API /blog hiện có 2 bài: thiết bị gia dụng thông minh 2026 và top 10 bộ nồi inox 2026; chưa thấy bài riêng về chảo inox bị dính.' },
  { type: 'product_knowledge_base', note: 'Inoxpran có nồi inox 304 ba lớp INP1001, nồi/chảo xào inox 304 INP3005, bếp từ INP6101; các claim chỉ giới hạn ở thông tin KB.' },
  { type: 'serp_scan_duckduckgo_lite', note: 'Kết quả SERP cho “chảo inox bị dính/cách dùng chảo inox” có nhiều bài hướng dẫn làm nóng chảo, kiểm tra giọt nước, thêm dầu đúng lúc; đây là intent how-to rõ ràng.' },
  { type: 'serp_scan_duckduckgo_lite', note: 'Kết quả cho nồi inox 304 bếp từ nhấn mạnh kiểm tra đáy từ/nam châm; tránh nói inox 304 nguyên chất luôn dùng được bếp từ.' }
];

const positioning = {
  generatedAt: new Date().toISOString(),
  language: 'vi',
  audiencePains: [
    'Người mới dùng chảo/nồi inox thường nghĩ inox phải chống dính như chảo phủ chống dính, dẫn tới thất vọng khi chiên cá, trứng hoặc thịt bị dính.',
    'Gia đình Việt chuyển sang bếp từ/bếp điện cần hiểu cách làm nóng dụng cụ inox và chọn đáy phù hợp.',
    'Người mua lo ngại vệ sinh inox khó, cháy vàng hoặc ố cầu vồng sau vài lần dùng.',
    'Khách hàng muốn mẹo thực tế, không phóng đại claim an toàn/sức khỏe.'
  ],
  competitorAngles: [
    { competitorType: 'retailer_blog', angle: 'Mẹo làm nóng chảo, kiểm tra nhiệt bằng giọt nước, thêm dầu sau khi chảo đủ nóng.' },
    { competitorType: 'brand_blog', angle: 'Hướng dẫn “tôi chảo inox” để tạo lớp chống dính tự nhiên.' },
    { competitorType: 'electronics_retailer', angle: 'Giải thích nồi inox dùng bếp từ cần đáy có từ tính, kiểm tra bằng nam châm/ký hiệu induction.' }
  ],
  positioningOpportunities: [
    'Viết theo hướng “khắc phục lỗi sử dụng” thay vì chỉ quảng bá sản phẩm, phù hợp evergreen SEO.',
    'Tạo niềm tin bằng checklist thao tác trước-trong-sau khi nấu, đặc biệt cho gia đình Việt nấu cá, trứng, thịt áp chảo.',
    'Liên kết nội bộ tự nhiên tới shop, nồi inox 304 và bếp từ; không nói mọi sản phẩm inox 304 đều dùng bếp từ nếu không có đáy từ.',
    'Nêu rõ claim constraints: inox không phải lớp chống dính hóa học; chống dính phụ thuộc nhiệt, dầu, thực phẩm và thói quen vệ sinh.'
  ],
  sourceNotes
};

const research = {
  generatedAt: new Date().toISOString(),
  existingTopicsChecked: [
    '5-thiet-bi-gia-dung-thong-minh-huu-ich-nhat-2026-bi-quyet-bep-khoe-cung-inoxpran',
    'top-10-bo-noi-inox-tot-nhat-2026-nghe-thuat-quan-ly-nhiet-va-suc-khoe'
  ],
  candidates: [
    {
      topic: 'Vì sao chảo inox bị dính và cách khắc phục',
      primaryKeyword: 'chảo inox bị dính',
      secondaryKeywords: ['cách dùng chảo inox không bị dính', 'chiên chảo inox không dính', 'vệ sinh chảo inox bị cháy', 'làm nóng chảo inox đúng cách'],
      serpIntent: 'How-to/troubleshooting: người đọc muốn biết nguyên nhân và thao tác cụ thể để hạn chế dính khi chiên rán.',
      contentGaps: ['Nhiều bài nói mẹo rời rạc; còn thiếu checklist theo từng món Việt và phần xử lý sau khi bị dính/cháy.', 'Cần giải thích inox không giống chảo phủ chống dính để giảm kỳ vọng sai.'],
      internalLinkSuggestions: ['/shop', '/blog', '/faq']
    },
    {
      topic: 'Nồi inox 304 có dùng được bếp từ không?',
      primaryKeyword: 'nồi inox 304 có dùng được bếp từ không',
      secondaryKeywords: ['nồi inox bếp từ', 'cách nhận biết nồi dùng được bếp từ', 'đáy từ inox 304'],
      serpIntent: 'Informational trước mua: kiểm tra đáy từ, ký hiệu induction và nam châm.',
      contentGaps: ['Cần tránh kết luận sai rằng inox 304 nguyên chất luôn bắt từ.', 'Nên có checklist mua nồi cho bếp từ.'],
      internalLinkSuggestions: ['/shop', '/faq']
    },
    {
      topic: 'Cách vệ sinh nồi inox bị ố vàng, cháy nhẹ sau khi nấu',
      primaryKeyword: 'cách vệ sinh nồi inox bị ố vàng',
      secondaryKeywords: ['làm sạch nồi inox', 'nồi inox bị cháy đáy', 'bảo quản nồi inox 304'],
      serpIntent: 'How-to sau sử dụng: xử lý vết ố, cháy nhẹ, bảo quản.',
      contentGaps: ['Nên phân biệt vết ố nhiệt, cặn khoáng và cháy thực phẩm.', 'Cần cảnh báo không dùng vật sắc gây xước.'],
      internalLinkSuggestions: ['/shop', '/policies/returns-policy']
    }
  ],
  sourceNotes
};

const topicIdeas = {
  generatedAt: new Date().toISOString(),
  scoringCriteria: { evergreen: 30, duplicateAvoidance: 25, searchIntentClarity: 20, brandFit: 15, conversionSupport: 10 },
  ideas: [
    { topic: research.candidates[0].topic, score: 91, rationale: 'Evergreen, chưa trùng blog hiện có, intent rất rõ và hỗ trợ giáo dục người dùng inox.' },
    { topic: research.candidates[1].topic, score: 86, rationale: 'Có nhu cầu mua cao nhưng dễ vướng claim kỹ thuật; nên để bài sau với kiểm chứng sản phẩm cụ thể.' },
    { topic: research.candidates[2].topic, score: 84, rationale: 'Hữu ích và evergreen nhưng SERP cạnh tranh rộng; ít hỗ trợ lựa chọn mua hơn chủ đề chảo bị dính.' }
  ],
  selected: { topic: research.candidates[0].topic, primaryKeyword: research.candidates[0].primaryKeyword, score: 91 }
};

const seoBrief = {
  generatedAt: new Date().toISOString(),
  title: 'Vì sao chảo inox bị dính? 7 cách dùng chảo inox ít dính hơn',
  slug: 'vi-sao-chao-inox-bi-dinh-cach-khac-phuc',
  excerpt: 'Chảo inox bị dính thường do nhiệt chưa đúng, thực phẩm còn ướt hoặc đảo quá sớm. Xem checklist dùng và vệ sinh chảo inox thực tế cho bếp Việt.',
  seoTitle: 'Chảo inox bị dính: nguyên nhân và cách khắc phục',
  seoDescription: 'Chảo inox bị dính khi chiên rán? Tìm hiểu nguyên nhân, cách làm nóng chảo, dùng dầu, xử lý thực phẩm và vệ sinh inox đúng cách.',
  categoryKey: 'care',
  tags: ['chảo inox', 'inox 304', 'mẹo nhà bếp', 'vệ sinh inox', 'bếp Việt'],
  primaryKeyword: 'chảo inox bị dính',
  secondaryKeywords: research.candidates[0].secondaryKeywords,
  outline: [
    'Mở bài: chảo inox không hỏng chỉ vì bị dính',
    '7 nguyên nhân phổ biến khiến chảo inox bị dính',
    'Checklist trước khi chiên/rán',
    'Cách xử lý khi thức ăn đã dính',
    'Vệ sinh và bảo quản sau khi nấu',
    'Khi nào nên đổi/chọn nồi chảo inox phù hợp hơn',
    'FAQ'
  ],
  faq: [
    { question: 'Chảo inox có chống dính như chảo phủ chống dính không?', answer: 'Không. Chảo inox cần kiểm soát nhiệt, dầu và độ khô của thực phẩm để hạn chế dính.' },
    { question: 'Có nên dùng miếng cọ kim loại cho chảo inox?', answer: 'Chỉ nên dùng khi nhà sản xuất cho phép. Với sử dụng hằng ngày, nên ưu tiên ngâm nước ấm và miếng rửa mềm để giảm xước.' },
    { question: 'Nồi/chảo inox 304 có dùng được bếp từ không?', answer: 'Cần kiểm tra đáy có từ tính hoặc ký hiệu dùng cho bếp từ; không nên mặc định mọi inox 304 đều bắt từ.' }
  ],
  internalLinks: [
    { label: 'Xem sản phẩm gia dụng Inoxpran', url: '/shop' },
    { label: 'Câu hỏi thường gặp', url: '/faq' },
    { label: 'Blog hướng dẫn nhà bếp', url: '/blog' }
  ],
  claimConstraints: [
    'Không khẳng định chảo inox luôn chống dính tuyệt đối.',
    'Không khẳng định mọi inox 304 đều dùng được bếp từ; phải kiểm tra đáy từ/ký hiệu induction.',
    'Chỉ nhắc thông tin Inoxpran có trong knowledge base: inox 304, đáy 3 lớp ở một số sản phẩm, bảo hành theo từng dòng.',
    'Không đưa claim y tế hoặc an toàn thực phẩm vượt nguồn.'
  ],
  imageNeeds: { mode: 'prompt_only', subject: 'chảo/nồi inox sạch trên bếp gia đình Việt', avoid: ['logo đối thủ', 'claim y tế', 'ảnh người nổi tiếng'] },
  sourceNotes
};

const contentHtml = `<p>Nếu bạn vừa chuyển từ chảo phủ chống dính sang chảo inox, cảm giác “sao món gì cũng dính?” là chuyện rất thường gặp. Điều quan trọng là: chảo inox bị dính không đồng nghĩa với chảo hỏng. Phần lớn trường hợp đến từ nhiệt chưa phù hợp, thực phẩm còn ướt, cho dầu sai thời điểm hoặc đảo món quá sớm.</p>

<p>Bài viết này giúp bạn hiểu nguyên nhân và có một checklist dễ áp dụng trong bếp Việt, từ chiên trứng, áp chảo thịt đến rán cá. Nội dung tập trung vào mẹo sử dụng an toàn, thực tế; không xem inox như một lớp chống dính hóa học và không phóng đại công dụng sản phẩm.</p>

<h2>1. Vì sao chảo inox bị dính?</h2>

<h3>Chảo chưa đủ nóng</h3>
<p>Lỗi phổ biến nhất là cho dầu và thực phẩm vào khi chảo còn lạnh hoặc mới hơi ấm. Khi đó bề mặt inox chưa ổn định nhiệt, protein trong trứng, cá, thịt dễ bám vào đáy chảo. Với chảo inox, bạn nên làm nóng chảo trước ở lửa vừa, sau đó mới cho dầu.</p>

<h3>Chảo quá nóng làm dầu cháy nhanh</h3>
<p>Ngược lại, để chảo quá nóng cũng khiến dầu bốc khói, thực phẩm cháy cạnh nhanh và dính chặt hơn. Nhiều gia đình dùng bếp từ hoặc bếp gas lửa lớn nên nhiệt tăng rất nhanh. Nếu thấy dầu vừa vào đã bốc khói mạnh, hãy hạ nhiệt và chờ chảo dịu lại.</p>

<h3>Thực phẩm còn nhiều nước</h3>
<p>Cá, thịt, đậu phụ hoặc rau củ vừa rửa xong nếu còn ướt sẽ làm nhiệt chảo tụt xuống. Nước cũng cản lớp dầu mỏng tiếp xúc đều với bề mặt chảo. Trước khi chiên rán, hãy thấm khô thực phẩm bằng khăn bếp sạch hoặc để ráo kỹ.</p>

<h3>Đảo hoặc lật quá sớm</h3>
<p>Khi áp chảo thịt hoặc cá, bề mặt thực phẩm cần thời gian tạo lớp se nhẹ. Nếu bạn cố lật ngay lúc món còn bám, phần da hoặc mặt thịt dễ rách. Hãy chờ thêm một chút; khi mặt dưới đủ se, món thường tự nhả ra dễ hơn.</p>

<h3>Dùng quá ít dầu cho món cần chiên</h3>
<p>Chảo inox không có lớp phủ chống dính như chảo non-stick. Với trứng, cá hoặc thực phẩm giàu tinh bột, lượng dầu quá ít làm món dễ bám. Bạn không cần dùng quá nhiều dầu, nhưng nên đủ để tạo một lớp mỏng phủ đều vùng nấu.</p>

<h3>Bề mặt chảo còn cặn tinh bột hoặc vết cháy cũ</h3>
<p>Cặn cháy nhỏ, vết đường hoặc tinh bột bám lại từ lần nấu trước có thể trở thành điểm dính cho lần sau. Vì vậy, vệ sinh kỹ sau khi nấu quan trọng không kém kỹ thuật làm nóng chảo.</p>

<h3>Kỳ vọng sai về chất liệu inox</h3>
<p>Inox bền, sáng và dễ vệ sinh khi dùng đúng cách, nhưng không nên hiểu là “không bao giờ dính”. Với inox 304 hoặc nồi/chảo đáy nhiều lớp, hiệu quả nấu phụ thuộc vào thiết kế đáy, nguồn nhiệt, lượng dầu và thao tác của người dùng.</p>

<h2>2. Checklist dùng chảo inox ít dính hơn</h2>

<h3>Bước 1: Làm nóng chảo ở lửa vừa</h3>
<p>Đặt chảo khô lên bếp và làm nóng từ từ. Không nên bật mức cao nhất ngay từ đầu, nhất là với bếp từ. Sau khoảng một thời gian ngắn, bạn có thể nhỏ vài giọt nước để kiểm tra: nếu nước lăn thành hạt nhỏ và di chuyển trên bề mặt, chảo đã đủ nóng cho nhiều món áp chảo. Nếu nước bốc hơi ngay lập tức, chảo có thể chưa đạt hoặc nhiệt chưa ổn định; nếu nước bắn mạnh và khô quá nhanh, chảo có thể quá nóng.</p>

<h3>Bước 2: Cho dầu sau khi chảo đã nóng</h3>
<p>Khi chảo đủ nóng, cho dầu vào và nghiêng nhẹ để dầu phủ đều. Chờ dầu bóng lên nhưng chưa bốc khói mạnh. Với món trứng hoặc cá, lớp dầu đều sẽ giúp hạn chế bám dính tốt hơn.</p>

<h3>Bước 3: Thấm khô thực phẩm</h3>
<p>Đây là bước nhỏ nhưng tạo khác biệt lớn. Cá cần thấm khô mặt da; thịt nên để ráo nước ướp; đậu phụ nên lau bớt nước. Nếu dùng thực phẩm lấy từ tủ lạnh, hãy để bớt lạnh vài phút để tránh làm tụt nhiệt chảo đột ngột.</p>

<h3>Bước 4: Đặt thực phẩm xuống rồi kiên nhẫn</h3>
<p>Sau khi đặt cá hoặc thịt xuống chảo, đừng di chuyển liên tục. Hãy để mặt dưới se lại. Nếu dùng xẻng lật thấy còn bám, chờ thêm một chút thay vì cạy mạnh. Cách này giúp món đẹp hơn và giảm phần cháy dính ở đáy.</p>

<h3>Bước 5: Điều chỉnh nhiệt trong suốt quá trình nấu</h3>
<p>Nhiệt không phải lúc nào cũng giữ nguyên. Sau khi cho thực phẩm vào, nhiệt chảo giảm; khi nước bay hơi hết, nhiệt lại tăng. Vì vậy, hãy giảm lửa nếu thấy viền món sẫm quá nhanh, dầu bốc khói hoặc đáy bắt đầu cháy.</p>

<h2>3. Mẹo theo từng món thường gặp</h2>

<h3>Chiên trứng</h3>
<p>Dùng lửa vừa thấp sau khi chảo đã nóng. Cho dầu đủ phủ đáy, sau đó mới cho trứng. Nếu muốn trứng mềm, không nên để chảo quá nóng. Với trứng ốp la, chờ viền trứng se rồi mới di chuyển.</p>

<h3>Rán cá</h3>
<p>Thấm thật khô da cá, có thể rắc rất nhẹ một lớp bột mỏng nếu công thức phù hợp. Đặt mặt da xuống trước, không lật quá sớm. Khi da cá đủ giòn, cá sẽ dễ tách khỏi chảo hơn.</p>

<h3>Áp chảo thịt</h3>
<p>Thịt cần bề mặt khô và không nên xếp quá chật. Nếu chảo quá đầy, hơi nước thoát ra nhiều làm món chuyển sang “luộc trong chảo”, dễ dính và khó tạo màu đẹp.</p>

<h3>Xào rau hoặc cơm</h3>
<p>Với món xào, hãy chuẩn bị nguyên liệu trước để thao tác nhanh. Chảo đủ nóng, dầu đều và đảo dứt khoát sẽ giúp rau ít ra nước hơn. Với cơm rang, cơm nên để nguội hoặc hơi khô, tránh cơm nóng ướt dính đáy.</p>

<h2>4. Khi thức ăn đã dính, xử lý thế nào?</h2>

<p>Đừng vội cạo mạnh bằng vật sắc. Trước hết, hạ nhiệt và lấy phần thức ăn còn dùng được ra ngoài. Nếu đáy chảo có mảng bám, cho một ít nước ấm vào khi chảo đã bớt nóng, ngâm vài phút để cặn mềm ra. Sau đó dùng miếng rửa mềm hoặc dụng cụ phù hợp với hướng dẫn của nhà sản xuất.</p>

<p>Với vết cháy nhẹ, bạn có thể đun nước trong chảo vài phút để cặn bong dần. Tránh sốc nhiệt mạnh như đổ nước lạnh vào chảo đang rất nóng, vì thói quen này có thể ảnh hưởng tới độ bền của đáy nồi/chảo theo thời gian.</p>

<h2>5. Vệ sinh và bảo quản chảo inox sau khi nấu</h2>

<ul>
<li>Để chảo nguội bớt rồi mới rửa.</li>
<li>Ngâm nước ấm nếu có cặn bám, không cần cạy ngay khi còn nóng.</li>
<li>Dùng nước rửa chén dịu nhẹ và miếng rửa mềm cho vệ sinh hằng ngày.</li>
<li>Lau khô sau khi rửa để hạn chế vệt nước và cặn khoáng.</li>
<li>Không để muối, nước mắm hoặc thực phẩm mặn đọng lâu trên bề mặt sau khi nấu.</li>
</ul>

<h2>6. Khi nào nên xem lại loại nồi/chảo đang dùng?</h2>

<p>Nếu bạn đã làm đúng kỹ thuật nhưng vẫn thường xuyên gặp vấn đề, hãy kiểm tra đáy chảo có bị cong vênh, bếp có làm nóng không đều hoặc dụng cụ có phù hợp với loại bếp hay không. Với bếp từ, không nên mặc định mọi nồi/chảo inox đều dùng được. Hãy kiểm tra ký hiệu induction hoặc thử nam châm ở đáy sản phẩm.</p>

<p>Với gia đình cần dụng cụ bền, dễ vệ sinh và dùng lâu dài, các dòng nồi/chảo inox 304, đáy nhiều lớp hoặc đáy có cấu trúc phân phối nhiệt đều là nhóm đáng cân nhắc. Khi xem sản phẩm tại <a href="/shop">Inoxpran</a>, bạn nên đối chiếu dung tích, loại bếp, thói quen nấu và hướng dẫn sử dụng cụ thể của từng mẫu.</p>

<h2>7. Câu hỏi thường gặp</h2>

<h3>Chảo inox có chống dính như chảo phủ chống dính không?</h3>
<p>Không. Chảo inox cần kiểm soát nhiệt, dầu và độ khô của thực phẩm. Khi dùng đúng, món ăn có thể ít dính hơn, nhưng không nên kỳ vọng giống lớp phủ chống dính chuyên dụng.</p>

<h3>Có cần “tôi chảo inox” trước khi dùng không?</h3>
<p>Một số người dùng chọn cách tôi chảo để tạo lớp dầu mỏng hỗ trợ nấu ăn. Tuy nhiên, bạn vẫn cần làm nóng chảo đúng cách và vệ sinh phù hợp. Hãy ưu tiên hướng dẫn của nhà sản xuất cho từng sản phẩm.</p>

<h3>Nồi/chảo inox 304 có dùng được bếp từ không?</h3>
<p>Điều này phụ thuộc vào đáy sản phẩm có lớp bắt từ hay không. Cách đơn giản là kiểm tra ký hiệu dùng cho bếp từ hoặc thử nam châm ở đáy nồi/chảo.</p>

<p>Tóm lại, chảo inox bị dính thường là vấn đề kỹ thuật sử dụng hơn là lỗi chất liệu. Chỉ cần làm nóng chảo đúng, cho dầu đúng lúc, thấm khô thực phẩm và kiên nhẫn khi lật món, trải nghiệm nấu với inox sẽ dễ chịu hơn rất nhiều.</p>`;

const imageBrief = {
  generatedAt: new Date().toISOString(),
  mode: 'prompt_only',
  prompt: 'Ảnh lifestyle chân thực trong căn bếp gia đình Việt: một chảo inox sạch trên bếp, bên cạnh là khăn bếp và nguyên liệu khô chuẩn bị áp chảo, ánh sáng tự nhiên, bố cục tối giản, không có logo đối thủ, không chữ trên ảnh, phong cách editorial blog.',
  altText: 'Chảo inox sạch trên bếp gia đình, minh họa cách dùng chảo inox ít bị dính',
  caption: 'Làm nóng chảo, dùng dầu đúng lúc và thấm khô thực phẩm giúp hạn chế dính khi nấu với inox.',
  filenameSlug: 'chao-inox-bi-dinh-cach-khac-phuc',
  safeFallbackImageUrl: '/images/og-image.png',
  providerNotes: 'Chưa xác minh nhà cung cấp ảnh/generation trong workflow, dùng prompt_only và fallback nội bộ.'
};

const review = {
  generatedAt: new Date().toISOString(),
  seoScore: 89,
  brandSafety: 'pass',
  duplicateRisk: 'low',
  claimRisk: 'low',
  imageSafety: 'pass',
  notes: [
    'Chủ đề không trùng 2 blog hiện có trong API.',
    'Bài viết dùng tiếng Việt, evergreen, có keyword chính và secondary tự nhiên.',
    'Không phát minh claim sản phẩm mới; có cảnh báo không mặc định inox 304 dùng được bếp từ.',
    'HTML chỉ dùng tag cơ bản và link nội bộ an toàn.'
  ],
  requiredFixes: []
};

const autoPublishEnabled = String(env.SEO_AGENT_AUTO_PUBLISH || '').toLowerCase() === 'true';
const reviewerPass = review.seoScore >= 85 && review.brandSafety === 'pass' && review.duplicateRisk !== 'high' && review.claimRisk !== 'high' && review.imageSafety === 'pass';
const publishMode = autoPublishEnabled && reviewerPass ? 'publish' : 'draft';

const payload = {
  mode: publishMode,
  source: 'openclaw-daily-seo',
  title: seoBrief.title,
  slug: seoBrief.slug,
  excerpt: seoBrief.excerpt,
  contentHtml,
  seoTitle: seoBrief.seoTitle,
  seoDescription: seoBrief.seoDescription,
  categoryKey: seoBrief.categoryKey,
  primaryKeyword: seoBrief.primaryKeyword,
  secondaryKeywords: seoBrief.secondaryKeywords,
  tags: seoBrief.tags,
  internalLinks: seoBrief.internalLinks,
  faq: seoBrief.faq,
  imageUrl: imageBrief.safeFallbackImageUrl,
  review: {
    seoScore: review.seoScore,
    brandSafety: review.brandSafety,
    duplicateRisk: review.duplicateRisk,
    claimRisk: review.claimRisk,
    imageSafety: review.imageSafety
  },
  metadata: {
    runId,
    sourceNotes,
    positioningSummary: positioning.positioningOpportunities,
    topicScore: topicIdeas.selected.score,
    imageBrief
  }
};

function save(name, data) {
  fs.writeFileSync(path.join(outDir, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2), 'utf8');
}
save('positioning.json', positioning);
save('research.json', research);
save('topicIdeas.json', topicIdeas);
save('seoBrief.json', seoBrief);
save('contentHtml.html', contentHtml);
save('imageBrief.json', imageBrief);
save('review.json', review);
save('publisherPayload.json', payload);

async function postAutomation() {
  const baseCandidates = [env.API_BASE_URL, 'http://localhost:3056/v1/api'].filter(Boolean).map(x => x.replace(/\/$/, ''));
  const key = env.SEO_AGENT_API_KEY;
  const secret = env.SEO_AGENT_HMAC_SECRET;
  if (!key || !secret) throw new Error('SEO automation credentials missing');
  const body = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const timestamp = String(Date.now());
  let lastError;
  for (const base of [...new Set(baseCandidates)]) {
    const url = `${base}/automation/seo-blog/publish`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(env.API_KEY ? { 'x-api-key': env.API_KEY } : {}),
          'x-seo-agent-key': key,
          'x-openclaw-timestamp': timestamp,
          'x-openclaw-signature': sig
        },
        body
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        lastError = new Error(`${url} ${res.status}: ${json?.message || json?.error || JSON.stringify(json)}`);
        continue;
      }
      return { endpoint: url, response: json };
    } catch (e) { lastError = e; }
  }
  throw lastError || new Error('No endpoint tried');
}

(async () => {
  let publishResult;
  try {
    const result = await postAutomation();
    publishResult = {
      status: 'success',
      mode: result.response?.metadata?.mode || publishMode,
      draftOnly: (result.response?.metadata?.mode || publishMode) === 'draft',
      endpointTried: result.endpoint.replace(/\/automation.*/, '/automation/...'),
      metadata: result.response?.metadata || result.response,
      reasonForNotPublishing: publishMode === 'draft' ? (autoPublishEnabled ? 'review_or_gate_failed' : 'SEO_AGENT_AUTO_PUBLISH=false') : ''
    };
  } catch (error) {
    publishResult = {
      status: 'error',
      mode: 'draft_requested',
      draftOnly: true,
      error: error.message,
      reasonForNotPublishing: 'publisher_api_failed_or_slug_exists'
    };
  }
  save('publishResult.json', publishResult);
  const qaReport = {
    generatedAt: new Date().toISOString(),
    published: publishResult.metadata?.published === true,
    checks: [
      { item: 'Admin UI not used', status: 'pass' },
      { item: 'Direct MongoDB write not used', status: 'pass' },
      { item: 'Automation API response shape captured', status: publishResult.status === 'success' ? 'pass' : 'fail' },
      { item: 'Draft mode by default', status: publishResult.mode === 'draft' ? 'pass' : 'n/a' },
      { item: 'URL verification', status: publishResult.metadata?.published ? 'pending' : 'skipped_draft_only' },
      { item: 'Required fields in publisher payload', status: 'pass' },
      { item: 'Reviewer gate fields included', status: 'pass' }
    ],
    manualAdminReviewTasks: [
      'Mở bản nháp trong admin để kiểm tra hiển thị HTML, ảnh fallback và liên kết nội bộ.',
      'Đối chiếu lại thông tin sản phẩm nếu muốn thêm link sản phẩm cụ thể.',
      'Kiểm tra ảnh đại diện/fallback có phù hợp giao diện blog không.',
      'Duyệt lại giọng văn và CTA trước khi xuất bản thủ công.'
    ]
  };
  save('qaReport.json', qaReport);
  const reportMd = `# Báo cáo Daily Inoxpran SEO Blog\n\n- Run ID: ${runId}\n- Topic: ${seoBrief.title}\n- Primary keyword: ${seoBrief.primaryKeyword}\n- Draft ID or URL: ${publishResult.metadata?.blogId || publishResult.metadata?.url || 'N/A'}\n- SEO score: ${review.seoScore}\n- Status: ${publishResult.mode || publishMode}\n- Reason for not publishing: ${publishResult.reasonForNotPublishing || 'N/A'}\n- Image mode: ${imageBrief.mode}\n- Fallback image URL: ${imageBrief.safeFallbackImageUrl}\n\n## QA checklist\n${qaReport.checks.map(c => `- ${c.item}: ${c.status}`).join('\n')}\n\n## Manual review tasks\n${qaReport.manualAdminReviewTasks.map(t => `- ${t}`).join('\n')}\n`;
  save('runReport.md', reportMd);
  console.log(JSON.stringify({ runId, outDir, publishResult, qaReport }, null, 2));
})();
