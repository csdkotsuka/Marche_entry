const SPREADSHEET_ID = "1JsWTeCi9Kfs2rv6PspxkOYvtq4zkLdSy0gS_qwrfjfM";
const SHEET_GID = "312516554";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
const FALLBACK_JSON_URL = "./data/applications.json";

const state = {
  rows: [],
  headers: [],
  search: "",
  filter: "all",
  group: "all",
  viewMode: localStorage.getItem("marche_view_mode") || "cards",
  hideContacts: localStorage.getItem("marche_hide_contacts") !== "false",
  lastFetchedAt: null,
  sourceLabel: "",
};

// DOM Elements
const els = {
  refreshBtn: document.getElementById("refreshBtn"),
  refreshIcon: document.getElementById("refreshIcon"),
  copyShareBtn: document.getElementById("copyShareBtn"),
  lastUpdated: document.getElementById("lastUpdated"),
  totalCount: document.getElementById("totalCount"),
  powerCount: document.getElementById("powerCount"),
  equipmentCount: document.getElementById("equipmentCount"),
  questionCount: document.getElementById("questionCount"),
  searchInput: document.getElementById("searchInput"),
  filterPills: document.querySelectorAll(".pill"),
  groupFilter: document.getElementById("groupFilter"),
  privacyToggle: document.getElementById("privacyToggle"),
  viewBtns: document.querySelectorAll(".view-btn"),
  statusBanner: document.getElementById("statusBanner"),
  visibleCountText: document.getElementById("visibleCountText"),
  cardsContainer: document.getElementById("cardsContainer"),
  tableContainer: document.getElementById("tableContainer"),
  tableBody: document.getElementById("tableBody"),
  emptyState: document.getElementById("emptyState"),
  detailModal: document.getElementById("detailModal"),
  modalTitle: document.getElementById("modalTitle"),
  modalGroupBadge: document.getElementById("modalGroupBadge"),
  modalBody: document.getElementById("modalBody"),
  closeModalBtn: document.getElementById("closeModalBtn"),
  toast: document.getElementById("toast"),
};

/**
 * RFC-4180 compliant CSV parser handling multiline quoted fields.
 */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\r" && next === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        i++;
      } else if (ch === "\n" || ch === "\r") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += ch;
      }
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function findCol(headers, keywords) {
  return headers.findIndex((h) => keywords.some((kw) => h.includes(kw)));
}

function normalizeRows(headers, rawRows) {
  const idx = {
    timestamp: findCol(headers, ["タイムスタンプ"]),
    email: findCol(headers, ["メールアドレス"]),
    name: findCol(headers, ["お名前"]),
    memberType: findCol(headers, ["該当するもの"]),
    group: findCol(headers, ["所属会"]),
    shopName: findCol(headers, ["屋号"]),
    phone: findCol(headers, ["電話番号"]),
    sns: findCol(headers, ["SNS"]),
    content: findCol(headers, ["出店内容"]),
    power: findCol(headers, ["電源使用"]),
    equipment: findCol(headers, ["備品貸し出し"]),
    equipmentDetail: findCol(headers, ["備品その他"]),
    setupTime: findCol(headers, ["設営"]),
    receiptName: findCol(headers, ["領収書名"]),
    question: findCol(headers, ["質問事項"]),
  };

  const get = (row, i) => (i >= 0 && row[i] ? row[i].trim() : "");

  return rawRows.map((row, index) => {
    const powerRaw = get(row, idx.power);
    const equipRaw = get(row, idx.equipment);
    const equipDetailRaw = get(row, idx.equipmentDetail);
    const questionRaw = get(row, idx.question);

    const needsPower = Boolean(powerRaw && !powerRaw.includes("不要"));
    const needsEquipment = Boolean(
      (equipRaw && !equipRaw.includes("不要")) || equipDetailRaw
    );

    return {
      no: index + 1,
      timestamp: get(row, idx.timestamp),
      email: get(row, idx.email),
      name: get(row, idx.name),
      memberType: get(row, idx.memberType),
      group: get(row, idx.group),
      shopName: get(row, idx.shopName),
      phone: get(row, idx.phone),
      sns: get(row, idx.sns),
      content: get(row, idx.content),
      power: powerRaw,
      needsPower,
      equipment: equipRaw,
      equipmentDetail: equipDetailRaw,
      needsEquipment,
      setupTime: get(row, idx.setupTime),
      receiptName: get(row, idx.receiptName),
      question: questionRaw,
      hasQuestion: Boolean(questionRaw),
      raw: row,
    };
  });
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatSnsLink(rawSns) {
  const val = (rawSns || "").trim();
  if (!val) return null;

  if (/^https?:\/\//i.test(val)) {
    return { url: val, label: "SNSリンク ↗" };
  }

  // Handle Instagram handle like @foo or foo
  const handle = val.replace(/^@/, "").split(/[\s,]/)[0];
  if (handle && /^[a-zA-Z0-9._]+$/.test(handle)) {
    return {
      url: `https://www.instagram.com/${encodeURIComponent(handle)}/`,
      label: `@${handle}`,
    };
  }

  return { url: null, label: val };
}

function renderSnsHtml(rawSns) {
  const sns = formatSnsLink(rawSns);
  if (!sns) return '<span class="text-muted">-</span>';
  if (sns.url) {
    return `<a class="sns-link" href="${escapeHtml(sns.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sns.label)}</a>`;
  }
  return `<span class="sns-link">${escapeHtml(sns.label)}</span>`;
}

function formatEquipSummary(item) {
  if (!item.needsEquipment) return "備品：不要";
  const parts = [];
  if (item.equipment && item.equipment !== "その他") {
    parts.push(item.equipment);
  }
  if (item.equipmentDetail) {
    parts.push(item.equipmentDetail);
  }
  return parts.length ? `備品：${parts.join(" / ")}` : "備品：あり";
}

function populateGroupFilter() {
  const current = state.group;
  const groups = Array.from(
    new Set(state.rows.map((r) => r.group).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "ja"));

  els.groupFilter.innerHTML = `<option value="all">所属会：すべて</option>`;
  for (const g of groups) {
    const opt = document.createElement("option");
    opt.value = g;
    opt.textContent = `所属会：${g}`;
    els.groupFilter.appendChild(opt);
  }
  els.groupFilter.value = groups.includes(current) ? current : "all";
  state.group = els.groupFilter.value;
}

function getFilteredRows() {
  const q = state.search.trim().toLowerCase();
  return state.rows.filter((item) => {
    if (state.filter === "power" && !item.needsPower) return false;
    if (state.filter === "equipment" && !item.needsEquipment) return false;
    if (state.filter === "question" && !item.hasQuestion) return false;
    if (state.group !== "all" && item.group !== state.group) return false;

    if (q) {
      const hay = [
        item.shopName,
        item.name,
        item.content,
        item.group,
        item.memberType,
        item.sns,
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderSummary() {
  els.totalCount.textContent = state.rows.length;
  els.powerCount.textContent = state.rows.filter((r) => r.needsPower).length;
  els.equipmentCount.textContent = state.rows.filter((r) => r.needsEquipment).length;
  els.questionCount.textContent = state.rows.filter((r) => r.hasQuestion).length;
}

function renderCards(items) {
  els.cardsContainer.innerHTML = items
    .map((item) => {
      const displayShop = item.shopName || item.name || "（屋号未設定）";
      const groupBadge = item.group || item.memberType || "一般";
      const contactBlock = state.hideContacts
        ? ""
        : `<div class="card-contact">
             <div>📧 ${escapeHtml(item.email || "-")}</div>
             <div>📞 ${escapeHtml(item.phone || "-")}</div>
           </div>`;

      return `
        <article class="exhibitor-card">
          <div class="card-top">
            <span class="card-number">No.${item.no}</span>
            <span class="card-group-badge">${escapeHtml(groupBadge)}</span>
          </div>
          <div>
            <h3 class="card-title">${escapeHtml(displayShop)}</h3>
            <div class="card-owner">お名前：${escapeHtml(item.name || "-")}</div>
          </div>
          <div class="card-content">${escapeHtml(item.content || "（出店内容の記載なし）")}</div>
          <div class="card-badges">
            <span class="tag ${item.needsPower ? "tag-power" : ""}">
              電源：${item.needsPower ? escapeHtml(item.power) : "不要"}
            </span>
            <span class="tag ${item.needsEquipment ? "tag-equipment" : ""}">
              ${escapeHtml(formatEquipSummary(item))}
            </span>
            ${item.setupTime ? `<span class="tag">設営：${escapeHtml(item.setupTime)}</span>` : ""}
            ${item.hasQuestion ? `<span class="tag tag-question">質問・備考あり</span>` : ""}
          </div>
          ${contactBlock}
          <div class="card-footer">
            ${renderSnsHtml(item.sns)}
            <button type="button" class="detail-btn" data-no="${item.no}">詳細を見る</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderTable(items) {
  const contactHeaders = document.querySelectorAll(".contact-col");
  contactHeaders.forEach((th) => {
    th.classList.toggle("hidden", state.hideContacts);
  });

  els.tableBody.innerHTML = items
    .map((item) => {
      const displayShop = item.shopName || item.name || "（未設定）";
      const contactCell = state.hideContacts
        ? ""
        : `<td>
             <div>${escapeHtml(item.email || "-")}</div>
             <div>${escapeHtml(item.phone || "-")}</div>
           </td>`;

      return `
        <tr>
          <td>${item.no}</td>
          <td>
            <div class="table-shop">${escapeHtml(displayShop)}</div>
            <div class="table-owner">${escapeHtml(item.name || "-")}</div>
          </td>
          <td>${escapeHtml(item.group || item.memberType || "-")}</td>
          <td><div class="table-content-cell">${escapeHtml(item.content || "-")}</div></td>
          <td>${renderSnsHtml(item.sns)}</td>
          <td>
            <span class="tag ${item.needsPower ? "tag-power" : ""}">
              ${item.needsPower ? escapeHtml(item.power) : "不要"}
            </span>
          </td>
          <td>${escapeHtml(formatEquipSummary(item).replace("備品：", ""))}</td>
          <td>${escapeHtml(item.setupTime || "-")}</td>
          ${contactCell}
          <td>
            <button type="button" class="detail-btn" data-no="${item.no}">詳細</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

function render() {
  const filtered = getFilteredRows();
  els.visibleCountText.textContent = `${filtered.length}件を表示中（全${state.rows.length}件）`;

  const isEmpty = filtered.length === 0;
  els.emptyState.classList.toggle("hidden", !isEmpty);

  if (state.viewMode === "cards") {
    els.cardsContainer.classList.toggle("hidden", isEmpty);
    els.tableContainer.classList.add("hidden");
    renderCards(filtered);
  } else {
    els.cardsContainer.classList.add("hidden");
    els.tableContainer.classList.toggle("hidden", isEmpty);
    renderTable(filtered);
  }

  if (state.lastFetchedAt) {
    const timeStr = state.lastFetchedAt.toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    els.lastUpdated.textContent = `最終更新: ${timeStr}（${state.sourceLabel}）`;
  }
}

function openModal(no) {
  const item = state.rows.find((r) => r.no === Number(no));
  if (!item) return;

  els.modalGroupBadge.textContent = item.group || item.memberType || "申込詳細";
  els.modalTitle.textContent = item.shopName || item.name || `No.${item.no}`;

  const contactHiddenKeys = ["メールアドレス", "電話番号"];
  const listHtml = state.headers
    .map((header, i) => {
      if (state.hideContacts && contactHiddenKeys.some((k) => header.includes(k))) {
        return "";
      }
      const val = item.raw[i] ? item.raw[i].trim() : "-";
      const cleanLabel = header.split("\n")[0];
      return `
        <div class="detail-item">
          <dt>${escapeHtml(cleanLabel)}</dt>
          <dd>${escapeHtml(val || "-")}</dd>
        </div>
      `;
    })
    .join("");

  els.modalBody.innerHTML = `<dl class="detail-list">${listHtml}</dl>`;
  els.detailModal.classList.remove("hidden");
}

function closeModal() {
  els.detailModal.classList.add("hidden");
}

let toastTimer = null;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.add("hidden");
  }, 3000);
}

async function fetchLatestData(isManual = false) {
  els.refreshBtn.disabled = true;
  els.refreshIcon.classList.add("spinning");
  els.statusBanner.classList.add("hidden");

  try {
    const res = await fetch(`${CSV_URL}&_t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const csvText = await res.text();
    const parsed = parseCSV(csvText);
    if (parsed.length < 1) throw new Error("データが空です");

    state.headers = parsed[0];
    state.rows = normalizeRows(state.headers, parsed.slice(1));
    state.lastFetchedAt = new Date();
    state.sourceLabel = "Googleスプレッドシート最新";

    populateGroupFilter();
    renderSummary();
    render();

    if (isManual) {
      showToast(`最新データに更新しました（${state.rows.length}件）`);
    }
  } catch (err) {
    console.warn("Live fetch failed, trying fallback JSON:", err);
    try {
      const fbRes = await fetch(`${FALLBACK_JSON_URL}?_t=${Date.now()}`);
      if (!fbRes.ok) throw new Error("Fallback unavailable");
      const fb = await fbRes.json();
      state.headers = fb.headers || [];
      state.rows = normalizeRows(state.headers, fb.rows || []);
      state.lastFetchedAt = fb.updatedAt ? new Date(fb.updatedAt) : new Date();
      state.sourceLabel = "GitHub保存スナップショット";

      populateGroupFilter();
      renderSummary();
      render();

      els.statusBanner.textContent =
        "Googleスプレッドシートへの直接接続に失敗したため、GitHub保存済みのスナップショットを表示しています。";
      els.statusBanner.classList.remove("hidden");
    } catch (fbErr) {
      els.statusBanner.textContent =
        "データの読み込みに失敗しました。インターネット接続またはスプレッドシートの共有設定をご確認ください。";
      els.statusBanner.classList.remove("hidden");
    }
  } finally {
    els.refreshBtn.disabled = false;
    els.refreshIcon.classList.remove("spinning");
  }
}

async function copyShareText() {
  const items = getFilteredRows();
  if (!items.length) {
    showToast("コピーするデータがありません");
    return;
  }

  const lines = [
    `【マルシェ 出店申し込み一覧】（${items.length}件）`,
    "",
    ...items.map((item) => {
      const shop = item.shopName || item.name || "（未設定）";
      const owner = item.shopName && item.name ? `（${item.name}）` : "";
      const group = item.group ? `[${item.group}] ` : "";
      const content = (item.content || "").replace(/\s+/g, " ").slice(0, 60);
      return `${item.no}. ${group}${shop}${owner}\n   内容: ${content}`;
    }),
  ];

  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    showToast(`共有用テキスト（${items.length}件）をコピーしました`);
  } catch {
    showToast("クリップボードへのコピーに失敗しました");
  }
}

// Event Listeners
els.refreshBtn.addEventListener("click", () => fetchLatestData(true));
els.copyShareBtn.addEventListener("click", copyShareText);

els.searchInput.addEventListener("input", (e) => {
  state.search = e.target.value;
  render();
});

els.filterPills.forEach((pill) => {
  pill.addEventListener("click", () => {
    els.filterPills.forEach((p) => p.classList.remove("active"));
    pill.classList.add("active");
    state.filter = pill.dataset.filter;
    render();
  });
});

els.groupFilter.addEventListener("change", (e) => {
  state.group = e.target.value;
  render();
});

els.privacyToggle.checked = state.hideContacts;
els.privacyToggle.addEventListener("change", (e) => {
  state.hideContacts = e.target.checked;
  localStorage.setItem("marche_hide_contacts", String(state.hideContacts));
  render();
});

els.viewBtns.forEach((btn) => {
  btn.classList.toggle("active", btn.dataset.view === state.viewMode);
  btn.addEventListener("click", () => {
    els.viewBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.viewMode = btn.dataset.view;
    localStorage.setItem("marche_view_mode", state.viewMode);
    render();
  });
});

document.addEventListener("click", (e) => {
  const detailBtn = e.target.closest(".detail-btn");
  if (detailBtn) {
    openModal(detailBtn.dataset.no);
  }
});

els.closeModalBtn.addEventListener("click", closeModal);
els.detailModal.addEventListener("click", (e) => {
  if (e.target === els.detailModal) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

// Init
fetchLatestData(false);
