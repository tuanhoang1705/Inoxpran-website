import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
    reviewOriginality,
    structuralFingerprint,
    structuralSimilarity
} = require('../src/utils/agenticBlogCore.util')

// Two genuinely different articles that happen to share the shape every
// competent blog post has: a flat run of <h2>, a mix of question/statement
// headings, medium paragraphs.
const rackedArticle = `<article>
<p>Công tắc ở vị trí tắt chưa phải tín hiệu để kiểm tra lưới bằng tay, vì phần tụ điện có thể còn tích điện trong một khoảng thời gian ngắn sau khi ngắt nguồn.</p>
<h2>Tắt vợt rồi có chạm được vào lưới không?</h2>
<p>Không nên. Hướng dẫn sử dụng phổ biến khuyến cáo tránh chạm tay vào mặt lưới kể cả khi thiết bị đã tắt, và đây là khuyến cáo định tính chứ không phải một ngưỡng đo cụ thể.</p>
<h2>Chờ bao lâu trước khi vệ sinh lưới</h2>
<p>Hãy tách rõ bước tắt nguồn, bước chờ và bước vệ sinh. Dùng chổi khô hoặc bàn chải mềm đi kèm thay cho ngón tay, và không dùng nước lên phần thân chứa mạch điện.</p>
<h2>3. Dấu hiệu cần ngừng sử dụng</h2>
<p>Vỏ nứt, dây sạc sờn, tay cầm ẩm hoặc có mùi khét là những dấu hiệu nên ngừng dùng và mang đi kiểm tra thay vì tiếp tục sạc thêm một lần nữa cho xong việc.</p>
<h2>Cất giữ khi nhà có trẻ nhỏ</h2>
<p>Chọn vị trí cao, khô ráo, tách khỏi khu vực đồ chơi. Rút sạc sau khi đầy và không cất khi thân vợt còn ẩm sau lúc lau chùi bề mặt lưới.</p>
<h2>Nên kiểm tra lại vào lúc nào?</h2>
<p>Trước mỗi mùa cao điểm muỗi, và sau bất kỳ lần rơi mạnh nào. Một vòng kiểm tra ngắn thường đủ để phát hiện hỏng hóc trước khi nó thành sự cố điện.</p>
</article>`

const cookwareArticle = `<article>
<p>Chảo inox nguội quá nhanh khi cho thực phẩm lạnh vào lòng chảo, và đó là lý do món xào hay bị dính dù người nấu đã tráng dầu đầy đủ từ trước đó.</p>
<h2>Làm nóng chảo tới mức nào là đủ</h2>
<p>Đun ở lửa vừa và thử bằng vài giọt nước. Khi giọt nước trượt thành hạt tròn thay vì sôi lăn tăn, mặt chảo đã đủ nóng để cho dầu vào mà không bén.</p>
<h2>Vì sao thịt vẫn dính vào đáy chảo?</h2>
<p>Thường do thực phẩm còn lạnh hoặc còn ướt. Thấm khô bề mặt và để nguyên liệu bớt lạnh trước khi thả vào sẽ giảm hiện tượng bám đáy rõ rệt hơn việc tăng lửa.</p>
<h2>2. Thứ tự cho gia vị vào món xào</h2>
<p>Gia vị dạng bột dễ cháy ở nhiệt cao nên cho sau cùng. Hành tỏi phi trước ở lửa vừa, rau củ cứng vào trước, rau lá mềm vào sau để giữ được độ giòn.</p>
<h2>Vệ sinh sau khi nấu món nhiều dầu</h2>
<p>Chờ chảo nguội bớt rồi mới ngâm nước ấm. Thay đổi nhiệt độ đột ngột dễ làm cong đáy, khiến chảo tiếp nhiệt không đều trong những lần nấu về sau.</p>
<h2>Khi nào nên thay chảo mới?</h2>
<p>Khi đáy đã cong rõ, tay cầm lỏng mối nối hoặc lớp bề mặt bong tróc. Những hỏng hóc này ảnh hưởng trực tiếp tới việc truyền nhiệt và độ an toàn khi cầm nắm.</p>
</article>`

// The deterministic template bank: same headings every time, only the topic word
// changes. This is what a real structural clone looks like.
const templateA = `<article><p>Mở bài A.</p>
<h2>Giai đoạn nhận ra nhu cầu</h2><p>Nội dung một về nồi áp suất và thói quen nấu của gia đình Việt hiện nay.</p>
<h2>Giai đoạn thu hẹp tiêu chí</h2><p>Nội dung hai về vật liệu, cấu tạo và hướng dẫn của nhà sản xuất.</p>
<h2>Giai đoạn kiểm chứng thông tin sản phẩm</h2><p>Nội dung ba về cách đối chiếu thông số với nhu cầu.</p>
<h2>Bước tiếp theo phù hợp</h2><p>Nội dung bốn về việc hỏi thêm tư vấn trước khi quyết định.</p></article>`

const templateB = `<article><p>Mở bài B.</p>
<h2>Giai đoạn nhận ra nhu cầu</h2><p>Nội dung một về nồi áp suất và thói quen nấu của gia đình Việt hiện nay.</p>
<h2>Giai đoạn thu hẹp tiêu chí</h2><p>Nội dung hai về vật liệu, cấu tạo và hướng dẫn của nhà sản xuất.</p>
<h2>Giai đoạn kiểm chứng thông tin sản phẩm</h2><p>Nội dung ba về cách đối chiếu thông số với nhu cầu.</p>
<h2>Bước tiếp theo phù hợp</h2><p>Nội dung bốn về việc hỏi thêm tư vấn trước khi quyết định.</p></article>`

describe('originality structure gate', () => {
    it('does not call two articles duplicates when they share a shape but not the words', () => {
        const verdict = reviewOriginality({
            title: 'Tắt vợt muỗi rồi, vì sao vẫn không nên chạm tay vào lưới?',
            contentHtml: rackedArticle,
            existing: [{ _id: 'a', blog_title: 'Làm nóng chảo inox đúng cách', blog_content: cookwareArticle }]
        })
        expect(verdict.maximumSimilarity.content).toBeLessThan(0.2)
        expect(verdict.reasons).not.toContain('structural_similarity_high')
        expect(verdict.passed).toBe(true)
    })

    it('still catches the template bank refilled under a new topic', () => {
        const verdict = reviewOriginality({
            title: 'Chủ đề khác hẳn nhưng vẫn đổ vào một khuôn',
            contentHtml: templateA,
            existing: [{ _id: 'b', blog_title: 'Bài mẫu trước đó', blog_content: templateB }]
        })
        expect(verdict.passed).toBe(false)
        expect(verdict.reasons).toContain('structural_similarity_high')
    })

    it('reads heading modes as an ordered sequence, not a bag of labels', () => {
        const left = structuralFingerprint('<h2>Có nên dùng không?</h2><p>a</p><h2>Cách kiểm tra</h2><p>b</p>')
        const right = structuralFingerprint('<h2>Cách kiểm tra</h2><p>a</p><h2>Có nên dùng không?</h2><p>b</p>')
        // Same two modes, opposite order: a set comparison scored this a perfect 1.
        expect(structuralSimilarity(left, right)).toBeLessThan(1)
    })

    it('reports a perfect score for a fingerprint compared with itself', () => {
        const fingerprint = structuralFingerprint(rackedArticle)
        expect(structuralSimilarity(fingerprint, fingerprint)).toBe(1)
    })
})
