"use strict";

/**
 * SenninProxy Core Logic with Multi-Tab Management
 */
class SenninProxy {
  constructor() {
    this.form = document.getElementById("uv-form");
    this.address = document.getElementById("uv-address");
    this.progress = document.getElementById("sennin-progress");
    this.tabBar = document.getElementById("tab-bar");
    this.viewport = document.getElementById("viewport");
    this.addTabBtn = document.getElementById("add-tab-btn");
    this.heroUi = document.getElementById("hero-ui");
    
    this.btnBack = document.getElementById("btn-back");
    this.btnForward = document.getElementById("btn-forward");
    this.btnReload = document.getElementById("btn-reload");

    this.config = window.__uv$config;
    this.tabs = []; // { id, title, url, iframe, tabEl }
    this.activeTabId = null;

    this.init();
  }

  init() {
    if (!this.form || !this.address || !this.config) return;

    // サービスワーカー登録
    navigator.serviceWorker.register("/uv/sw.js", {
      scope: this.config.prefix
    }).then(() => {
      this.setupEventListeners();
      // 起動時にひとつタブを作成
      this.createNewTab();
    });
  }

  setupEventListeners() {
    this.form.addEventListener("submit", (e) => this.handleRequest(e));
    this.addTabBtn.addEventListener("click", () => this.createNewTab());

    // ナビゲーションボタンの制御
    this.btnBack.addEventListener("click", () => this.navigateTab('back'));
    this.btnForward.addEventListener("click", () => this.navigateTab('forward'));
    this.btnReload.addEventListener("click", () => this.navigateTab('reload'));
    
    // 入力欄フォーカス時にテキスト全選択
    this.address.addEventListener("focus", () => this.address.select());
  }

  // XORエンコード (UV標準)
  encodeUrl(str) {
    if (!str) return "";
    return encodeURIComponent(
      String(str)
        .split("")
        .map((c, i) => (i % 2 ? String.fromCharCode(c.charCodeAt(0) ^ 2) : c))
        .join("")
    );
  }

  // 入力解析
  resolveInput(val) {
    const s = val.trim();
    const urlPattern = /^(https?|ftp):\/\/[^\s]+$/i;
    const hostPattern = /^((\d{1,3}\.){3}\d{1,3}|([a-z0-9-]+\.)+[a-z]{2,})(:\d+)?(\/.*)?$/i;

    if (urlPattern.test(s)) return s;
    if (hostPattern.test(s)) return "https://" + s;
    return null;
  }

  updateProgress(percent) {
    this.progress.style.opacity = "1";
    this.progress.style.width = percent + "%";
    if (percent >= 100) {
      setTimeout(() => {
        this.progress.style.opacity = "0";
        setTimeout(() => { this.progress.style.width = "0%"; }, 300);
      }, 500);
    }
  }

  // 新しいタブを作成
  createNewTab(url = null) {
    const id = Date.now().toString();
    
    // タブ要素(DOM)の作成
    const tabEl = document.createElement("div");
    tabEl.className = "tab";
    tabEl.id = `tab-${id}`;
    tabEl.innerHTML = `
      <span class="tab-title">新しいタブ</span>
      <span class="tab-close">×</span>
    `;
    
    // iframe要素(DOM)の作成
    const iframe = document.createElement("iframe");
    iframe.id = `iframe-${id}`;

    const tabObj = { id, title: "新しいタブ", url, iframe, tabEl };
    this.tabs.push(tabObj);
    
    this.tabBar.insertBefore(tabEl, this.addTabBtn);
    this.viewport.appendChild(iframe);

    // タブクリックイベント
    tabEl.addEventListener("click", (e) => {
      if (e.target.classList.contains("tab-close")) {
        this.closeTab(id);
      } else {
        this.switchTab(id);
      }
    });

    this.switchTab(id);

    if (url) {
      this.loadUrlInTab(id, url);
    } else {
      this.address.value = "";
      this.address.focus();
    }
  }

  // タブ切り替え
  switchTab(id) {
    this.tabs.forEach(tab => {
      tab.tabEl.classList.remove("active");
      tab.iframe.classList.remove("active");
    });

    const activeTab = this.tabs.find(t => t.id === id);
    if (activeTab) {
      activeTab.tabEl.classList.add("active");
      activeTab.iframe.classList.add("active");
      this.activeTabId = id;
      this.address.value = activeTab.url || "";
      
      // コンテンツの有無でHero UIを切り替え
      if (activeTab.url) {
        this.heroUi.classList.add("hidden");
      } else {
        this.heroUi.classList.remove("hidden");
      }
    }
  }

  // タブを閉じる
  closeTab(id) {
    const index = this.tabs.findIndex(t => t.id === id);
    if (index === -1) return;

    const tab = this.tabs[index];
    tab.tabEl.remove();
    tab.iframe.remove();
    this.tabs.splice(index, 1);

    // すべて閉じたら新しいタブを作成
    if (this.tabs.length === 0) {
      this.createNewTab();
    } else if (this.activeTabId === id) {
      // 閉じたタブがアクティブだった場合、最後のタブに切り替え
      this.switchTab(this.tabs[this.tabs.length - 1].id);
    }
  }

  // アクティブなタブ内でのナビゲーション
  navigateTab(action) {
    const activeTab = this.tabs.find(t => t.id === this.activeTabId);
    if (!activeTab || !activeTab.url) return;

    try {
      if (action === 'back') activeTab.iframe.contentWindow.history.back();
      if (action === 'forward') activeTab.iframe.contentWindow.history.forward();
      if (action === 'reload') activeTab.iframe.src = activeTab.iframe.src;
    } catch (e) {
      console.warn("Navigation failed:", e);
    }
  }

  // 特定のタブにURLをロード
  loadUrlInTab(id, url) {
    const tab = this.tabs.find(t => t.id === id);
    if (!tab) return;

    this.updateProgress(30);
    tab.url = url;
    if (this.activeTabId === id) {
      this.address.value = url;
      this.heroUi.classList.add("hidden");
    }

    tab.tabEl.querySelector(".tab-title").innerText = "読み込み中...";
    
    // プロキシURLの生成
    const proxyUrl = this.config.prefix + this.encodeUrl(url);
    tab.iframe.src = proxyUrl;

    tab.iframe.onload = () => {
      this.updateProgress(100);
      // タイトルをドメイン名に更新
      try {
        const domain = new URL(url).hostname;
        tab.tabEl.querySelector(".tab-title").innerText = domain;
      } catch {
        tab.tabEl.querySelector(".tab-title").innerText = url;
      }
    };
  }

  // フォーム送信ハンドラ
  async handleRequest(e) {
    e.preventDefault();
    const query = this.address.value.trim();
    if (!query || !this.activeTabId) return;

    const resolved = this.resolveInput(query);
    let targetUrl = resolved;

    if (!resolved) {
      // URLでない場合は検索 (DuckDuckGoをデフォルトに使用)
      targetUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
    }

    this.loadUrlInTab(this.activeTabId, targetUrl);
  }
}

// 実行
window.addEventListener("DOMContentLoaded", () => {
  new SenninProxy();
});
