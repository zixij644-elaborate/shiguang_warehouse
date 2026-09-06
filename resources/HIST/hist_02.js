// 河南科技学院（青果 / KINGOSOFT 教务系统） 空闲教室查询 辅助工具
//
// 数据结构（真实导出"空闲教室一览表.xls"为 HTML）：
//   - 一个导出对应"一个星期"，标题形如 "河南科技学院…空闲教室一览表 第1-18周 星期一"
//   - 其后按 "校区：…/教室类型：…" 分组，每组一张 "教室|容量" 小表，列出该类型空闲教室
//
// 用法：登录教务系统打开"空闲教室一览表"页面后点击执行即可（支持 iframe），
//       或用 URL 抓取。
//
// 适配者：@星河欲转 社区贡献（河南科技学院）
// 注意：请在开发者/真机模式实测；若页面结构与导出略有差异，可调整 collectFreeRooms。

const DAYS = '一二三四五六日';

function isLoginPage() {
    const url = window.location.href;
    if (url.indexOf('/cas/') !== -1) return true;
    if (url.indexOf('jwgl.hist.edu.cn') !== -1 && /login\.action|login\.jsp|\/cas\//i.test(url)) return true;
    return false;
}

function cellText(c) {
    return (c.innerText || c.textContent || '').replace(/\s+/g, ' ').trim();
}

function allTables(root) {
    const out = [];
    const scan = (r) => {
        try {
            for (const tb of Array.from(r.document.querySelectorAll('table'))) out.push(tb);
            for (const fr of Array.from(r.frames || [])) { try { scan(fr); } catch (e) {} }
        } catch (e) {}
    };
    scan(root);
    return out;
}

function isDataTable(table) {
    const tr = table.querySelector('tr');
    if (!tr) return false;
    const hdr = Array.from(tr.children).map(cellText);
    return hdr.some(h => h === '教室') && hdr.some(h => /容量/.test(h));
}

function collectRooms(table) {
    const rooms = [];
    const rows = Array.from(table.querySelectorAll('tr'));
    for (const row of rows) {
        const cells = Array.from(row.children).map(cellText);
        // "教室|容量" 交替：偶数下标为教室名，奇数下标为容量
        for (let i = 0; i < cells.length; i += 2) {
            const r = cells[i];
            if (r && r !== '教室') rooms.push(r);
        }
    }
    return rooms;
}

async function runImportFlow() {
    if (isLoginPage()) {
        window.shiguangBridge.showToast('请先登录教务系统，再打开“空闲教室一览表”页面！');
        return;
    }

    const confirmed = await window.shiguangBridgePromise.showAlert(
        '空闲教室查询',
        '请在教务系统打开“空闲教室一览表”页面（选好星期后）再点“开始查询”。',
        '开始查询'
    );
    if (!confirmed) return;

    const tables = allTables(window);
    let day = '';
    let titleText = '';
    for (const tb of tables) {
        const t = tb.innerText || tb.textContent || '';
        if (t.includes('空闲教室一览表')) {
            titleText = t.replace(/\s+/g, ' ').trim();
            const m = t.match(/星期([一二三四五六日])/);
            if (m) day = m[1];
            break;
        }
    }
    if (!titleText) {
        window.shiguangBridge.showToast('未找到空闲教室报表，请确认已在“空闲教室一览表”页面。');
        return;
    }

    const groups = [];
    let currentType = '';
    for (const tb of tables) {
        const text = tb.innerText || tb.textContent || '';
        const typeMatch = text.match(/教室类型[:：]\s*([^\s]+)/);
        if (typeMatch) currentType = typeMatch[1].trim();
        if (isDataTable(tb)) {
            const rooms = collectRooms(tb);
            if (rooms.length) groups.push({ type: currentType || '(未分类)', rooms });
        }
    }

    if (groups.length === 0) {
        window.shiguangBridge.showToast('该报表里没有识别到教室列表。');
        return;
    }

    let out = '【星期' + (day || '?') + '】空闲教室\n\n';
    for (const g of groups) {
        out += g.type + '（' + g.rooms.length + ' 间）：\n  ' + g.rooms.join('　') + '\n';
    }

    window.shiguangBridge.showToast('查询完成');
    await window.shiguangBridgePromise.showAlert('空闲教室一览表', out, '好的');
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
