/**
 * about.js - 关于区块的二维码内联展示逻辑
 * 
 * 功能：点击"加入交流群"或"打赏作者"链接后，
 * 在设置页面底部展开/收起对应的二维码图片。
 * 
 * 说明：由于 Manifest V3 禁止内联脚本，
 * 此逻辑必须放在独立的 .js 文件中通过 <script src> 引入。
 */

// 二维码配置：定义不同类型的图片路径和说明文字
const QR_CONFIG = {
    group: {
        image: 'icons/qr-group.png',
        desc: '扫描二维码加入飞书交流群'
    },
    donate: {
        image: 'icons/qr-donate.png',
        desc: '感谢你的支持 ❤️'
    }
};

// 记录当前展示的二维码类型，null 表示当前没有展示
let currentOpenType = null;

/**
 * 切换显示二维码
 * - 如果点击的是当前正在展示的类型，则收起
 * - 如果点击的是另一种类型，则切换显示
 * - 如果当前没有展示，则展开
 * @param {string} type - 'group'（交流群）或 'donate'（打赏）
 */
function toggleInlineQr(type) {
    const container = document.getElementById('inline-qr-container');
    const img = document.getElementById('inline-qr-image');
    const desc = document.getElementById('inline-qr-desc');
    const config = QR_CONFIG[type];

    if (!config || !container || !img || !desc) return;

    // 如果点击的是当前正在展示的，则收起
    if (currentOpenType === type) {
        container.style.display = 'none';
        currentOpenType = null;
        return;
    }

    // 更新内容并显示
    img.src = config.image;
    desc.textContent = config.desc;
    container.style.display = 'block';
    currentOpenType = type;

    // 平滑滚动到视野（如果需要）
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// 页面加载完成后绑定点击事件
document.addEventListener('DOMContentLoaded', () => {
    // 绑定"加入交流群"链接
    const groupLink = document.getElementById('about-link-group');
    if (groupLink) {
        groupLink.addEventListener('click', (e) => {
            e.preventDefault();
            toggleInlineQr('group');
        });
    }

    // 绑定"打赏作者"链接
    const donateLink = document.getElementById('about-link-donate');
    if (donateLink) {
        donateLink.addEventListener('click', (e) => {
            e.preventDefault();
            toggleInlineQr('donate');
        });
    }
});
