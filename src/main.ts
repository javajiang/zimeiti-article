import {
  App,
  Editor,
  ItemView,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Modal,
  Setting,
  TFile,
  TFolder,
  WorkspaceLeaf,
} from "obsidian";

const VIEW_TYPE_ZIMEITI = "zimeiti-article-guide";
const API_BASE_URL = "https://lingshuzhisuan.cn/";
const API_MODEL = "claude-sonnet-4-20250514";
const STYLE_LIBRARY_FOLDER = "文章风格库";
const OUTPUT_FOLDER = "生成稿";
const ARTICLE_STYLE_START = "[ARTICLE_STYLE_START]";
const ARTICLE_STYLE_END = "[ARTICLE_STYLE_END]";

interface ZimeitiSettings {
  apiKey: string;
  styleLibraryFolder: string;
  outputFolder: string;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{
            type?: string;
            text?: string;
          }>;
    };
  }>;
}

interface ArticleGenerationOptions {
  title: string;
  userRequest: string;
  styleName: string;
  stylePath: TFile | null;
  outputFolder: string;
}

const DEFAULT_SETTINGS: ZimeitiSettings = {
  apiKey: "",
  styleLibraryFolder: "",
  outputFolder: "",
};

export default class ZimeitiArticlePlugin extends Plugin {
  settings: ZimeitiSettings = DEFAULT_SETTINGS;

  getStyleLibraryFolder() {
    return this.settings.styleLibraryFolder.trim() || STYLE_LIBRARY_FOLDER;
  }

  getOutputFolder() {
    return this.settings.outputFolder.trim() || OUTPUT_FOLDER;
  }

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_ZIMEITI, (leaf) => new ZimeitiGuideView(leaf));

    this.addRibbonIcon("sparkles", "Open Zimeiti Article guide", async () => {
      await this.activateGuide();
    });
    this.addRibbonIcon("book-open", "Open article documentation", async () => {
      await this.openDocumentation();
    });

    this.addCommand({
      id: "open-zimeiti-article-guide",
      name: "Open article guide",
      callback: async () => this.activateGuide(),
    });
    this.addCommand({
      id: "open-zimeiti-article-docs",
      name: "打开文章插件说明书",
      callback: async () => this.openDocumentation(),
    });

    this.addCommand({
      id: "article-distill-current-note",
      name: "当前笔记文章风格蒸馏",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return void new Notice("请先打开一篇笔记。");
        await this.extractStyleToNote(file);
      },
    });

    this.addCommand({
      id: "article-distill-multiple-notes",
      name: "从多篇笔记文章风格蒸馏",
      callback: async () => {
        new NoteSelectionModal(this.app, async (files) => {
          const name = await this.promptStyleName(files);
          if (!name) return void new Notice("已取消命名。");
          await this.extractStyleFromFiles(files, name);
        }).open();
      },
    });

    this.addCommand({
      id: "article-generate-from-folder",
      name: "生成文章",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return void new Notice("请先在文件夹中选择一个笔记。");
        const parent = this.app.vault.getAbstractFileByPath(file.parent?.path ?? "");
        if (parent instanceof TFolder) await this.generateArticleFromFolder(parent);
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && file.extension === "md") {
          menu.addItem((item) =>
            item.setTitle("文章风格蒸馏").setIcon("sparkles").onClick(async () => {
              const styleName = await this.promptStyleName([file]);
              if (!styleName) return void new Notice("已取消命名。");
              await this.extractStyleToNote(file, styleName);
            }),
          );
          return;
        }

        if (file instanceof TFolder) {
          menu.addItem((item) =>
            item.setTitle("生成文章").setIcon("file-plus").onClick(async () => {
              await this.generateArticleFromFolder(file);
            }),
          );
        }
      }),
    );

    this.registerEvent(
      this.app.workspace.on("files-menu", (menu, files) => {
        const markdownFiles = files.filter((file) => file instanceof TFile && file.extension === "md") as TFile[];
        if (markdownFiles.length === 0) return;

        menu.addItem((item) =>
          item.setTitle("文章风格蒸馏").setIcon("sparkles").onClick(async () => {
            const styleName = await this.promptStyleName(markdownFiles);
            if (!styleName) return void new Notice("已取消命名。");
            await this.extractStyleFromFiles(markdownFiles, styleName);
          }),
        );
      }),
    );

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, view) => {
        menu.addItem((item) =>
          item.setTitle("提取选中文本风格").setIcon("text").onClick(async () => {
            if (view instanceof MarkdownView) {
              await this.handleSelectedTextStyle(editor, view);
            }
          }),
        );
      }),
    );

    this.addSettingTab(new ZimeitiSettingTab(this.app, this));
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_ZIMEITI);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async activateGuide() {
    let leaf: WorkspaceLeaf | null | undefined = this.app.workspace.getLeavesOfType(VIEW_TYPE_ZIMEITI)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? undefined;
      await leaf?.setViewState({ type: VIEW_TYPE_ZIMEITI, active: true });
    }
    if (leaf) this.app.workspace.revealLeaf(leaf);
  }

  async openDocumentation() {
    await this.openOrCreateNote(
      "文章插件说明.md",
      [
        "# Zimeiti Article 说明书",
        "",
        "面向内容创作者的 Obsidian 插件，用于蒸馏对标文章风格，并基于风格仿写新文章。",
        "",
        "## 适用人群",
        "- 公众号作者",
        "- 小红书/知乎/博客内容创作者",
        "- 新媒体编辑",
        "- 需要批量对标文章风格的人",
        "",
        "## 核心能力",
        "- 单篇文章风格蒸馏",
        "- 多篇文章风格蒸馏",
        "- 基于风格生成文章",
        "- 风格结果保存到 `文章风格库`",
        "- 生成结果保存到 `生成稿`",
      ].join("\n"),
    );
  }

  async openOrCreateNote(path: string, content: string) {
    const normalized = path.replace(/^\/+/, "");
    let file = this.app.vault.getAbstractFileByPath(normalized);
    if (!(file instanceof TFile)) {
      await this.ensureOutputNote(normalized, content);
      file = this.app.vault.getAbstractFileByPath(normalized);
    }
    if (file instanceof TFile) {
      const leaf = this.app.workspace.getLeaf(true);
      await leaf.openFile(file);
      this.app.workspace.revealLeaf(leaf);
    }
  }

  async ensureFileExists(file: TFile): Promise<boolean> {
    return await this.app.vault.adapter.exists(file.path);
  }

  async extractStyleToNote(file: TFile, styleName?: string) {
    new Notice("文章风格蒸馏处理中...");
    if (!(await this.ensureFileExists(file))) {
      return void new Notice(`已跳过不存在的笔记：${file.basename}`);
    }
    const content = await this.app.vault.cachedRead(file);
    const result = await this.requestStyleExtraction(content, styleName ?? file.basename);
    await this.ensureOutputNote(`${STYLE_LIBRARY_FOLDER}/${this.normalizeFileName(styleName ?? file.basename)}.md`, result);
    new Notice("风格规则已保存。");
  }

  async extractStyleFromFiles(files: TFile[], styleName: string) {
    new Notice("文章风格蒸馏处理中...");
    const contents: string[] = [];
    const validFiles: TFile[] = [];
    const missingFiles: TFile[] = [];
    for (const file of files) {
      if (await this.ensureFileExists(file)) validFiles.push(file);
      else missingFiles.push(file);
    }
    if (missingFiles.length > 0) {
      new Notice(`已跳过 ${missingFiles.length} 篇不存在的笔记。`);
    }
    if (validFiles.length === 0) {
      return void new Notice("没有可用的笔记文件。");
    }
    for (const file of validFiles) {
      const content = await this.app.vault.cachedRead(file);
      contents.push(`## ${file.basename}\n\n${content}`);
    }
    const result = await this.requestStyleExtraction(contents.join("\n\n"), styleName);
    await this.ensureOutputNote(
      `${STYLE_LIBRARY_FOLDER}/${this.normalizeFileName(styleName)}.md`,
      this.wrapStyleSkill(styleName, validFiles, result),
    );
    new Notice("风格 skill 已保存。");
  }

  async handleSelectedTextStyle(editor: Editor, view: MarkdownView) {
    const selection = editor.getSelection().trim();
    if (!selection) return void new Notice("请先选中文本。");
    const file = view.file;
    const noteName = file?.basename ?? "selected-text";
    if (file && !(await this.ensureFileExists(file))) {
      return void new Notice(`已跳过不存在的笔记：${file.basename}`);
    }
    const result = await this.requestStyleExtraction(selection, noteName);
    await this.ensureOutputNote(`${STYLE_LIBRARY_FOLDER}/${noteName}-selection-style.md`, result);
    new Notice("选中文本风格蒸馏已保存。");
  }

  async generateArticleFromFolder(folder: TFolder) {
    const options = await this.promptArticleGeneration(folder, folder.path);
    if (!options) return void new Notice("已取消生成。");

    let styleContent = "";
    if (options.stylePath) {
      if (!(await this.ensureFileExists(options.stylePath))) {
        new Notice(`已跳过不存在的风格文件：${options.stylePath.basename}`);
      } else {
        styleContent = await this.app.vault.cachedRead(options.stylePath);
      }
    }
    new Notice("文章生成处理中...");
    const result = await this.requestArticleGeneration(folder.name, {
      title: options.title,
      userRequest: options.userRequest,
      styleName: options.styleName,
      styleContent,
    });
    const outputFolder = (options.outputFolder || folder.path || this.getOutputFolder()).replace(/^\/+/, "");
    const outputName = this.normalizeFileName(options.title.trim() || `${folder.name}-generated`);
    await this.ensureOutputNote(`${outputFolder}/${outputName}.md`, result);
    new Notice("生成文章已保存。");
  }

  async promptStyleName(files: TFile[]): Promise<string | null> {
    const defaultName = files.length === 1 ? files[0].basename : "新风格";
    return await new Promise((resolve) => new StyleNameModal(this.app, defaultName, files.length, resolve).open());
  }

  async promptArticleGeneration(folder: TFolder, defaultOutputFolder = ""): Promise<ArticleGenerationOptions | null> {
    const styleFiles = this.app.vault.getMarkdownFiles().filter((item) => item.path.startsWith(`${this.getStyleLibraryFolder()}/`)).sort((a, b) => a.basename.localeCompare(b.basename));
    return await new Promise((resolve) => new ArticleGenerationModal(this.app, "", defaultOutputFolder || folder.path, styleFiles, resolve).open());
  }

  async requestStyleExtraction(content: string, noteName: string): Promise<string> {
    const prompt = [
      `请分析下面这篇文章的写作风格并进行风格蒸馏，文件名是《${noteName}》。`,
      "请不要输出固定模板式的段落名，比如“第1段”“第2段”。",
      "请输出为结构化 Markdown，必须包含这些部分：",
      `1. 风格块必须放在固定标记中：${ARTICLE_STYLE_START} 和 ${ARTICLE_STYLE_END}`,
      "2. 完整风格分析",
      "3. 文章结构 / 写作方式",
      "4. 信息推进逻辑",
      "5. 标题风格",
      "6. 开头方式",
      "7. 语气特点",
      "8. 句子长短特征",
      "9. 常见表达方式",
      "10. 文章目的 / 适用场景",
      "11. 目标读者",
      "12. 证据 / 例子使用方式",
      "13. 写作边界 / 禁忌",
      "14. 可复用写作规则",
      "",
      "要求：",
      `- ${ARTICLE_STYLE_START} 和 ${ARTICLE_STYLE_END} 必须原样输出，不要改写。`,
      "- 风格块内只保留压缩后的可复用规则，不要写分析废话。",
      "- 每个字段内容必须压缩表达，适合后续直接用于写作生成。",
      "- 文章结构 / 写作方式要描述整体写法，不要写成固定段落模板。",
      "文章内容：",
      content,
    ].join("\n");
    return this.runChatCompletion([{ role: "system", content: "你是中文内容风格分析助手。" }, { role: "user", content: prompt }], `# ${noteName} 风格规则`);
  }

  async requestArticleGeneration(noteName: string, options: { title: string; userRequest: string; styleName: string; styleContent: string; }): Promise<string> {
    const extractedStyle = this.extractArticleStyleBlock(options.styleContent);
    const styleBlock = extractedStyle.trim()
      ? ["风格规则：", `风格名称：${options.styleName}`, extractedStyle.trim()].join("\n")
      : "风格规则：\n（未选择风格）";
    const prompt = [
      "你是一个中文文章生成助手。",
      "",
      "请根据用户需求生成一篇原创文章。",
      "如果提供了风格规则，请同时遵循风格规则；如果没有提供风格规则，就按通用高质量写作生成。",
      "",
      styleBlock,
      "",
      "用户需求：",
      options.userRequest.trim(),
      "",
      "写作要求：",
      "- 内容必须围绕用户需求展开，不能偏题。",
      "- 如果提供了风格规则，必须遵循其中的标题风格、开头方式、语气特点、文章结构/写作方式、句子长短特征、常见表达方式和信息推进逻辑。",
      "- 如果没有提供风格规则，就不要强行模仿特定风格，直接生成自然、清晰、可读性强的文章。",
      "- 不要复述风格规则本身。",
      "- 文章必须原创，不要复用现成文本。",
      "- 适合碎片化阅读，使用多段落、短句子。",
      "- 每一段只表达一个核心意思，避免大段堆叠。",
      options.title.trim() ? `- 用户提供了标题《${options.title.trim()}》，正文第一行必须原样使用这个标题。` : "- 用户未提供标题时，请你自己生成一个合适标题。",
      "",
      "输出格式：",
      "1. 标题",
      "2. 正文",
      "",
      `当前参考文件名：${noteName}`,
    ].join("\n");
    return this.runChatCompletion([{ role: "system", content: "你是中文文章生成助手。" }, { role: "user", content: prompt }], `# ${options.title || noteName} 生成稿`);
  }

  extractArticleStyleBlock(markdown: string): string {
    const content = String(markdown || "").trim();
    if (!content) return "";
    const start = content.indexOf(ARTICLE_STYLE_START);
    const end = content.indexOf(ARTICLE_STYLE_END);
    if (start !== -1 && end !== -1 && end > start) {
      return content.slice(start + ARTICLE_STYLE_START.length, end).trim();
    }
    return content;
  }

  async runChatCompletion(messages: ChatMessage[], fallbackTitle: string): Promise<string> {
    if (!this.settings.apiKey) {
      throw new Notice("请先在插件设置中填写 API Key。");
    }

    try {
      const response = await fetch(this.normalizeBaseUrl(API_BASE_URL), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.settings.apiKey}`,
        },
        body: JSON.stringify({
          model: API_MODEL,
          messages,
          max_tokens: 16000,
          thinking: { type: "enabled", budget_tokens: 10240 },
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`HTTP ${response.status}: ${detail}`);
      }

      const data = (await response.json()) as ChatCompletionResponse;
      const content = this.extractMessageContent(data);
      if (!content) {
        throw new Error("Model response is empty.");
      }
      return content;
    } catch (error) {
      console.error("Zimeiti article request failed", error);
      const detail = error instanceof Error ? error.message : String(error);
      new Notice(`模型调用失败：${detail}`);
      return `${fallbackTitle}\n\n模型调用失败：${detail}`;
    }
  }

  normalizeBaseUrl(baseUrl: string): string {
    const trimmed = baseUrl.trim().replace(/\/+$/, "");
    if (trimmed.endsWith("/v1/chat/completions") || trimmed.endsWith("/chat/completions")) {
      return trimmed;
    }
    if (trimmed.endsWith("/v1")) {
      return `${trimmed}/chat/completions`;
    }
    return `${trimmed}/v1/chat/completions`;
  }

  extractMessageContent(data: ChatCompletionResponse): string {
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      return content.trim();
    }
    if (Array.isArray(content)) {
      return content
        .map((part) => (part?.type === "text" || typeof part?.text === "string" ? part.text ?? "" : ""))
        .join("")
        .trim();
    }
    return "";
  }

  wrapStyleSkill(styleName: string, files: TFile[], body: string): string {
    return [`---`, `name: ${styleName}`, `type: style-skill`, `source_notes:`, ...files.map((file) => `- ${file.path}`), `---`, ``, `# 风格技能：${styleName}`, ``, body.trim()].join("\n");
  }

  normalizeFileName(name: string): string {
    return name.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-");
  }

  async ensureOutputNote(path: string, content: string) {
    const normalized = path.replace(/^\/+/, "");
    const parent = normalized.split("/").slice(0, -1).join("/");
    if (parent && !this.app.vault.getAbstractFileByPath(parent)) await this.app.vault.createFolder(parent);
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFile) return void await this.app.vault.modify(existing, content);
    await this.app.vault.create(normalized, content);
  }
}

class ZimeitiGuideView extends ItemView {
  getViewType() { return VIEW_TYPE_ZIMEITI; }
  getDisplayText() { return "Zimeiti Article"; }
  getIcon() { return "sparkles"; }
  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Zimeiti Article" });
    contentEl.createEl("p", { text: "文章插件：只负责文章蒸馏与文章生成。", cls: "zimeiti-muted" });
  }
}

class ZimeitiSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ZimeitiArticlePlugin) { super(app, plugin); }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("API Key").addText((text) => text.setValue(this.plugin.settings.apiKey).onChange(async (value) => { this.plugin.settings.apiKey = value.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("风格目录").addText((text) => text.setValue(this.plugin.settings.styleLibraryFolder).onChange(async (value) => { this.plugin.settings.styleLibraryFolder = value.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("输出目录").addText((text) => text.setValue(this.plugin.settings.outputFolder).onChange(async (value) => { this.plugin.settings.outputFolder = value.trim(); await this.plugin.saveSettings(); }));
  }
}

class NoteSelectionModal extends Modal {
  allFiles: TFile[] = [];
  filteredFiles: TFile[] = [];
  selected = new Set<TFile>();
  committed = false;
  searchInput!: HTMLInputElement;
  resultsEl!: HTMLDivElement;
  countEl!: HTMLElement;
  confirmBtn!: HTMLButtonElement;
  emptyEl!: HTMLDivElement;

  constructor(app: App, private onChoose: (files: TFile[]) => void) { super(app); }

  onOpen() {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    titleEl.empty();
    titleEl.addClass("zimeiti-note-modal-title");
    titleEl.createSpan({ text: "选择笔记" });

    const actions = titleEl.createDiv({ cls: "zimeiti-note-modal-actions" });
    this.countEl = actions.createSpan({ cls: "zimeiti-note-modal-count", text: "已选 0 篇" });
    this.confirmBtn = actions.createEl("button", {
      cls: "zimeiti-note-modal-confirm",
      attr: { "aria-label": "确认提交" },
    });
    this.confirmBtn.setText("✓");
    this.confirmBtn.disabled = true;
    this.confirmBtn.addEventListener("click", () => this.submit());

    this.allFiles = this.app.vault.getMarkdownFiles().filter((file) => !file.path.startsWith(`${STYLE_LIBRARY_FOLDER}/`));
    this.filteredFiles = [...this.allFiles];

    const searchWrap = contentEl.createDiv({ cls: "zimeiti-note-modal-search" });
    this.searchInput = searchWrap.createEl("input", {
      type: "search",
      placeholder: "搜索并勾选多篇笔记",
    });
    this.searchInput.addEventListener("input", () => this.refreshResults());
    this.searchInput.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        this.submit();
      }
    });

    this.resultsEl = contentEl.createDiv({ cls: "zimeiti-note-modal-results" });
    this.emptyEl = this.resultsEl.createDiv({ cls: "zimeiti-note-modal-empty" });
    this.emptyEl.setText("没有匹配到笔记。");

    this.refreshResults();
    window.setTimeout(() => this.searchInput.focus(), 0);
  }

  matchesQuery(file: TFile, query: string) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return true;
    return file.path.toLowerCase().includes(normalized) || file.basename.toLowerCase().includes(normalized);
  }

  refreshResults() {
    const query = this.searchInput?.value ?? "";
    this.filteredFiles = this.allFiles.filter((file) => this.matchesQuery(file, query));
    this.renderResults();
    this.refreshCount();
  }

  renderResults() {
    this.resultsEl.empty();
    if (this.filteredFiles.length === 0) {
      this.resultsEl.appendChild(this.emptyEl);
      return;
    }

    for (const file of this.filteredFiles) {
      const row = this.resultsEl.createDiv({ cls: "zimeiti-note-modal-row" });
      if (this.selected.has(file)) row.addClass("is-selected");

      const main = row.createDiv({ cls: "zimeiti-note-modal-row-main" });
      main.createDiv({ cls: "zimeiti-note-modal-row-title", text: file.basename });
      main.createDiv({ cls: "zimeiti-note-modal-row-path", text: file.path });

      const mark = row.createDiv({ cls: "zimeiti-note-modal-row-mark" });
      mark.setText(this.selected.has(file) ? "✓" : "");

      row.addEventListener("click", () => this.toggleSelection(file));
    }
  }

  toggleSelection(file: TFile) {
    if (this.selected.has(file)) this.selected.delete(file);
    else this.selected.add(file);
    this.renderResults();
    this.refreshCount();
  }

  refreshCount() {
    this.countEl.setText(`已选 ${this.selected.size} 篇`);
    this.confirmBtn.disabled = this.selected.size === 0;
  }

  submit() {
    if (this.selected.size === 0) {
      new Notice("请先选择至少一篇笔记。");
      return;
    }
    this.committed = true;
    this.close();
  }

  onClose() {
    if (this.committed && this.selected.size > 0) {
      this.onChoose([...this.selected]);
    }
  }
}

class StyleNameModal extends Modal {
  inputEl!: HTMLInputElement;

  constructor(app: App, private defaultName: string, private noteCount: number, private onSubmit: (value: string | null) => void) { super(app); }

  onOpen() {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    titleEl.setText("输入风格名称");

    contentEl.createEl("p", {
      text: `当前将对 ${this.noteCount} 篇笔记进行文章风格蒸馏。`,
      cls: "zimeiti-muted",
    });

    this.inputEl = contentEl.createEl("input", {
      type: "text",
      value: this.defaultName,
      placeholder: "请输入风格名称",
    });
    this.inputEl.style.width = "100%";
    this.inputEl.style.marginTop = "12px";

    const actions = contentEl.createDiv({ cls: "zimeiti-style-name-actions" });
    const cancel = actions.createEl("button", { text: "取消" });
    const confirm = actions.createEl("button", { text: "确认", cls: "mod-cta" });

    const submit = () => {
      const value = this.inputEl.value.trim();
      this.close();
      this.onSubmit(value || null);
    };

    confirm.addEventListener("click", submit);
    cancel.addEventListener("click", () => {
      this.close();
      this.onSubmit(null);
    });
    this.inputEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        submit();
      }
    });

    window.setTimeout(() => this.inputEl.focus(), 0);
  }
}

class ArticleGenerationModal extends Modal {
  titleInput!: HTMLInputElement;
  requestInput!: HTMLTextAreaElement;
  styleSelect!: HTMLSelectElement;
  outputFolderInput!: HTMLInputElement;

  constructor(app: App, private defaultTitle: string, private defaultOutputFolder: string, private styleFiles: TFile[], private onSubmit: (value: ArticleGenerationOptions | null) => void) { super(app); }

  onOpen() {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    titleEl.setText("生成文章");

    const titleField = contentEl.createDiv({ cls: "zimeiti-form-field" });
    titleField.createEl("label", { text: "标题（可选）" });
    this.titleInput = titleField.createEl("input", {
      type: "text",
      value: this.defaultTitle,
      placeholder: "留空则由模型生成标题",
    });

    const requestField = contentEl.createDiv({ cls: "zimeiti-form-field" });
    requestField.createEl("label", { text: "用户需求" });
    this.requestInput = requestField.createEl("textarea", {
      placeholder: "输入本次要生成的主题、角度、字数、用途等",
    });
    this.requestInput.rows = 6;

    const styleField = contentEl.createDiv({ cls: "zimeiti-form-field" });
    styleField.createEl("label", { text: "风格（可选）" });
    this.styleSelect = styleField.createEl("select");
    this.styleSelect.createEl("option", { text: "不选择风格", value: "" });
    for (const file of this.styleFiles) {
      this.styleSelect.createEl("option", {
        text: file.basename,
        value: file.path,
      });
    }

    const outputField = contentEl.createDiv({ cls: "zimeiti-form-field" });
    outputField.createEl("label", { text: "输出目录（可选）" });
    this.outputFolderInput = outputField.createEl("input", {
      type: "text",
      value: this.defaultOutputFolder || OUTPUT_FOLDER,
      placeholder: OUTPUT_FOLDER,
    });

    const actions = contentEl.createDiv({ cls: "zimeiti-style-name-actions" });
    const cancel = actions.createEl("button", { text: "取消" });
    const confirm = actions.createEl("button", { text: "确认", cls: "mod-cta" });

    const submit = () => {
      const userRequest = this.requestInput.value.trim();
      if (!userRequest) {
        new Notice("请先输入用户需求。");
        return;
      }

      const selectedPath = this.styleSelect.value;
      const selectedStyle = this.styleFiles.find((file) => file.path === selectedPath) ?? null;
      const styleName = selectedStyle?.basename ?? "";

      this.close();
      this.onSubmit({
        title: this.titleInput.value.trim(),
        userRequest,
        styleName,
        stylePath: selectedStyle,
        outputFolder: this.outputFolderInput.value.trim(),
      });
    };

    confirm.addEventListener("click", submit);
    cancel.addEventListener("click", () => {
      this.close();
      this.onSubmit(null);
    });
    this.requestInput.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" && (evt.ctrlKey || evt.metaKey)) {
        evt.preventDefault();
        submit();
      }
    });

    window.setTimeout(() => this.requestInput.focus(), 0);
  }
}
