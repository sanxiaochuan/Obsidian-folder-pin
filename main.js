// Pin Folder Plugin for Obsidian
// 将重要文件夹固定在文件浏览器顶部

const { Plugin, TFile, TFolder, WorkspaceLeaf, addIcon, PluginSettingTab, Setting, Menu, Notice } = require('obsidian');

// 默认设置
const DEFAULT_SETTINGS = {
	pinnedFolders: [],
	sortOrder: [],
	showPinIcon: true,
	enableDragSort: true,
	groupPinnedFolders: true
};

// 主插件类
class PinFolderPlugin extends Plugin {
	constructor() {
		super(...arguments);
		this.settings = DEFAULT_SETTINGS;
		this.pinManager = null;
	}

	async onload() {
		await this.loadSettings();

		// 添加固定图标
		this.addPinIcon();

		// 初始化PinManager
		this.pinManager = new PinManager(this);

		// 添加设置标签页
		this.addSettingTab(new SettingsTab(this.app, this));

		// 注册命令
		this.addCommands();

		// 监听文件浏览器变化
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				if (this.pinManager) {
					this.pinManager.refreshFileExplorer();
				}
			})
		);

		// 初始化时刷新文件浏览器
		setTimeout(() => {
			if (this.pinManager) {
				this.pinManager.refreshFileExplorer();
			}
		}, 2000);
	}

	onunload() {
		if (this.pinManager) {
			this.pinManager.cleanup();
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		if (this.pinManager) {
			this.pinManager.refreshFileExplorer();
		}
	}

	addPinIcon() {
		addIcon('pin', `
			<svg viewBox="0 0 24 24" width="100" height="100">
				<path fill="currentColor" d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12M10,4H14V12H10V4Z" />
			</svg>
		`);
		
		// 添加取消固定图标
		addIcon('pin-off', `
			<svg viewBox="0 0 24 24" width="100" height="100">
				<path fill="currentColor" d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12M10,4H14V12H10V4Z" />
				<path fill="currentColor" d="M2,2L22,22" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
			</svg>
		`);
	}

	addCommands() {
		// 固定当前文件夹命令
		this.addCommand({
			id: 'pin-current-folder',
			name: 'Pin current folder',
			callback: () => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile) {
					const folder = activeFile.parent;
					if (folder) {
						this.pinManager.togglePin(folder.path);
					}
				}
			}
		});

		// 取消固定所有文件夹命令
		this.addCommand({
			id: 'unpin-all-folders',
			name: 'Unpin all folders',
			callback: () => {
				this.pinManager.unpinAll();
			}
		});

		// 刷新文件浏览器命令
		this.addCommand({
			id: 'refresh-file-explorer',
			name: 'Refresh file explorer',
			callback: () => {
				this.pinManager.refreshFileExplorer();
			}
		});

		// 调试命令
		this.addCommand({
			id: 'debug-pin-status',
			name: 'Debug pin status',
			callback: () => {
				const leaf = this.getFileExplorerLeaf();
				if (leaf) {
					const fileExplorer = leaf.view;
					console.log('File Explorer:', fileExplorer);
					console.log('File Items:', fileExplorer.fileItems);
					console.log('Pinned Folders:', this.settings.pinnedFolders);
					console.log('Sort Order:', this.settings.sortOrder);
					new Notice(`Debug info logged to console. Pinned: ${this.settings.pinnedFolders.length} folders`);
				} else {
					new Notice('File explorer not found');
				}
			}
		});
	}

	// 获取文件浏览器叶子节点
	getFileExplorerLeaf() {
		const leaves = this.app.workspace.getLeavesOfType('file-explorer');
		return leaves.length > 0 ? leaves[0] : null;
	}
}

// PinManager类 - 管理文件夹固定逻辑
class PinManager {
	constructor(plugin) {
		this.plugin = plugin;
		this.fileExplorer = null;
		this.originalSort = null;
		this.initializeFileExplorer();
	}

	initializeFileExplorer() {
		const leaf = this.plugin.getFileExplorerLeaf();
		if (leaf) {
			this.fileExplorer = leaf.view;
			this.hookFileExplorer();
		} else {
			// 如果文件浏览器还没有加载，等待一下再试
			setTimeout(() => {
				this.initializeFileExplorer();
			}, 1000);
		}
	}

	hookFileExplorer() {
		if (!this.fileExplorer) return;

		// 保存原始排序方法
		this.originalSort = this.fileExplorer.sort;

		// 重写排序方法
		this.fileExplorer.sort = (items) => {
			return this.sortWithPinnedFolders(items);
		};

		// 添加右键菜单
		this.addContextMenu();

		// 定期检查并添加图标
		this.startIconCheck();

		// 添加固定文件夹到顶部
		this.addPinnedFoldersToTop();
	}

	startIconCheck() {
		const checkIcons = () => {
			this.addPinIcons();
			// 减少固定文件夹容器的检查频率，避免不必要的重新渲染
			if (Math.random() < 0.3) { // 30%的概率检查
				this.addPinnedFoldersToTop();
			}
			setTimeout(checkIcons, 5000); // 增加检查间隔到5秒
		};
		setTimeout(checkIcons, 2000);
	}

	addPinnedFoldersToTop() {
		if (!this.fileExplorer) return;

		const container = this.fileExplorer.containerEl;
		if (!container) return;

		// 查找或创建固定文件夹容器
		let pinnedContainer = container.querySelector('.pinned-folders-container');
		
		if (!this.plugin.settings.groupPinnedFolders) {
			// 如果设置关闭，隐藏容器
			if (pinnedContainer) {
				pinnedContainer.style.display = 'none';
			}
			return;
		}

		// 如果设置开启，显示容器
		if (pinnedContainer) {
			pinnedContainer.style.display = 'block';
			// 检查是否需要重新渲染
			const currentPinnedCount = pinnedContainer.querySelectorAll('.pinned-folder-item').length;
			const hasExpanded = pinnedContainer.getAttribute('data-has-expanded') === 'true';
			
			// 只有在固定文件夹列表发生变化且没有展开的文件夹时才重新渲染
			if (currentPinnedCount !== this.plugin.settings.pinnedFolders.length && !hasExpanded) {
				this.renderPinnedFoldersInContainer(pinnedContainer);
			}
		} else {
			// 创建新的固定文件夹容器
			pinnedContainer = container.createDiv('pinned-folders-container');
			pinnedContainer.style.borderBottom = '1px solid var(--background-modifier-border)';
			pinnedContainer.style.paddingBottom = '8px';
			pinnedContainer.style.marginBottom = '8px';
			
			// 将固定文件夹容器插入到文件列表顶部
			const navFileContainer = container.querySelector('.nav-files-container');
			if (navFileContainer) {
				navFileContainer.insertBefore(pinnedContainer, navFileContainer.firstChild);
			}
			
			this.renderPinnedFoldersInContainer(pinnedContainer);
		}
	}

	renderPinnedFoldersInContainer(container) {
		// 保存当前展开状态
		const expandedStates = {};
		const existingItems = container.querySelectorAll('.pinned-folder-item');
		existingItems.forEach(item => {
			const path = item.getAttribute('data-folder-path');
			if (path && item.hasClass('expanded')) {
				expandedStates[path] = true;
			}
		});

		container.empty();

		if (this.plugin.settings.pinnedFolders.length === 0) {
			return;
		}

		// 添加标题 - 已隐藏
		// const title = container.createDiv('pinned-folders-title');
		// title.textContent = '📌 Pinned Folders';
		// title.style.fontSize = '12px';
		// title.style.fontWeight = '600';
		// title.style.color = 'var(--text-muted)';
		// title.style.marginBottom = '4px';
		// title.style.padding = '4px 8px';

		// 渲染固定文件夹
		this.plugin.settings.sortOrder.forEach((folderPath) => {
			if (!this.plugin.settings.pinnedFolders.includes(folderPath)) {
				return;
			}

			const folderItem = container.createDiv('pinned-folder-item');
			folderItem.setAttribute('data-folder-path', folderPath);
			folderItem.style.display = 'flex';
			folderItem.style.alignItems = 'center';
			folderItem.style.padding = '4px 8px';
			folderItem.style.borderRadius = '4px';
			folderItem.style.marginBottom = '2px';
			folderItem.style.cursor = 'pointer';
			folderItem.style.fontSize = '14px';
			folderItem.style.position = 'relative';

			// 悬停效果
			folderItem.addEventListener('mouseenter', () => {
				folderItem.style.backgroundColor = 'var(--background-modifier-hover)';
			});
			folderItem.addEventListener('mouseleave', () => {
				folderItem.style.backgroundColor = 'transparent';
			});

			// 点击展开/折叠文件夹内容 - 修复自动折叠问题
			folderItem.addEventListener('click', (e) => {
				e.stopPropagation(); // 防止事件冒泡
				this.toggleFolderExpansion(folderItem, folderPath);
			});

			// 固定图标
			const pinIcon = folderItem.createEl('span', {
				text: '📌',
				cls: 'pin-icon'
			});
			pinIcon.style.marginRight = '6px';
			pinIcon.style.fontSize = '12px';

			// 文件夹名称
			const folderName = folderItem.createEl('span', {
				text: folderPath.split('/').pop() || folderPath,
				cls: 'folder-name'
			});
			folderName.style.flex = '1';
			folderName.style.color = 'var(--text-normal)';

			// 展开箭头 - 修复重叠问题
			const expandIcon = folderItem.createEl('span', {
				cls: 'expand-icon',
				text: '▶'
			});
			expandIcon.style.marginLeft = '4px';
			expandIcon.style.marginRight = '20px'; // 为取消按钮留出空间
			expandIcon.style.fontSize = '10px';
			expandIcon.style.color = 'var(--text-muted)';
			expandIcon.style.position = 'relative';
			expandIcon.style.zIndex = '5';

			// 右键菜单
			folderItem.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				const menu = new Menu();
				menu.addItem(item => {
					item
						.setTitle('Unpin folder')
						.setIcon('pin-off')
						.onClick(() => {
							this.togglePin(folderPath);
						});
				});
				menu.showAtPosition({ x: e.clientX, y: e.clientY });
			});

			// 取消固定按钮（悬停时显示）
			const unpinButton = folderItem.createEl('button', {
				text: '×',
				cls: 'unpin-button'
			});
			unpinButton.style.position = 'absolute';
			unpinButton.style.right = '8px';
			unpinButton.style.background = 'var(--background-error)';
			unpinButton.style.color = 'var(--text-on-accent)';
			unpinButton.style.border = 'none';
			unpinButton.style.borderRadius = '50%';
			unpinButton.style.width = '16px';
			unpinButton.style.height = '16px';
			unpinButton.style.fontSize = '10px';
			unpinButton.style.cursor = 'pointer';
			unpinButton.style.display = 'none';
			unpinButton.style.lineHeight = '1';

			// 悬停时显示取消固定按钮
			folderItem.addEventListener('mouseenter', () => {
				unpinButton.style.display = 'block';
			});
			folderItem.addEventListener('mouseleave', () => {
				unpinButton.style.display = 'none';
			});

			unpinButton.addEventListener('click', (e) => {
				e.stopPropagation();
				e.preventDefault();
				this.togglePin(folderPath);
			});

			// 恢复展开状态
			if (expandedStates[folderPath]) {
				folderItem.addClass('expanded');
				const expandIcon = folderItem.querySelector('.expand-icon');
				if (expandIcon) {
					expandIcon.textContent = '▼';
				}
				// 重新展开文件夹内容
				setTimeout(() => {
					this.expandFolder(folderItem, folderPath, this.plugin.app.vault.getAbstractFileByPath(folderPath));
				}, 10);
			}
		});
	}

	toggleFolderExpansion(folderItem, folderPath) {
		const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
		if (!folder || !(folder instanceof TFolder)) return;

		// 检查是否已经展开
		const isExpanded = folderItem.hasClass('expanded');
		
		if (isExpanded) {
			// 折叠文件夹
			this.collapseFolder(folderItem, folderPath);
		} else {
			// 展开文件夹
			this.expandFolder(folderItem, folderPath, folder);
		}
	}

	expandFolder(folderItem, folderPath, folder) {
		// 添加展开状态类
		folderItem.addClass('expanded');
		
		// 更新展开箭头图标
		const expandIcon = folderItem.querySelector('.expand-icon');
		if (expandIcon) {
			expandIcon.textContent = '▼';
		}

		// 创建子内容容器
		let subContainer = folderItem.parentElement.querySelector(`.sub-folder-container[data-path="${folderPath}"]`);
		if (!subContainer) {
			subContainer = folderItem.parentElement.createDiv('sub-folder-container');
			subContainer.setAttribute('data-path', folderPath);
			subContainer.style.marginLeft = '20px';
			subContainer.style.marginTop = '4px';
			subContainer.style.borderLeft = '2px solid var(--background-modifier-border)';
			subContainer.style.paddingLeft = '8px';
			
			// 插入到当前文件夹项之后
			folderItem.parentElement.insertBefore(subContainer, folderItem.nextSibling);
		}

		// 标记容器为已展开，防止被重新渲染
		const pinnedContainer = folderItem.closest('.pinned-folders-container');
		if (pinnedContainer) {
			pinnedContainer.setAttribute('data-has-expanded', 'true');
		}

		// 渲染子内容
		this.renderSubFolderContent(subContainer, folder);
	}

	collapseFolder(folderItem, folderPath) {
		// 移除展开状态类
		folderItem.removeClass('expanded');
		
		// 更新展开箭头图标
		const expandIcon = folderItem.querySelector('.expand-icon');
		if (expandIcon) {
			expandIcon.textContent = '▶';
		}

		// 隐藏子内容容器
		const subContainer = folderItem.parentElement.querySelector(`.sub-folder-container[data-path="${folderPath}"]`);
		if (subContainer) {
			subContainer.style.display = 'none';
		}

		// 检查是否还有其他展开的文件夹，如果没有则清除展开标记
		const pinnedContainer = folderItem.closest('.pinned-folders-container');
		if (pinnedContainer) {
			const hasOtherExpanded = pinnedContainer.querySelector('.pinned-folder-item.expanded');
			if (!hasOtherExpanded) {
				pinnedContainer.removeAttribute('data-has-expanded');
			}
		}
	}

	renderSubFolderContent(container, folder) {
		container.empty();
		container.style.display = 'block';

		// 获取文件夹内容
		const children = folder.children;
		if (!children || children.length === 0) {
			const emptyMsg = container.createDiv('empty-folder-message');
			emptyMsg.textContent = 'Empty folder';
			emptyMsg.style.color = 'var(--text-muted)';
			emptyMsg.style.fontSize = '12px';
			emptyMsg.style.fontStyle = 'italic';
			emptyMsg.style.padding = '4px 8px';
			return;
		}

		// 按类型和名称排序
		const sortedChildren = children.sort((a, b) => {
			// 文件夹优先
			if (a instanceof TFolder && b instanceof TFile) return -1;
			if (a instanceof TFile && b instanceof TFolder) return 1;
			// 同类型按名称排序
			return a.name.localeCompare(b.name);
		});

		// 渲染子项
		sortedChildren.forEach(child => {
			const childItem = container.createDiv('sub-folder-item');
			childItem.style.display = 'flex';
			childItem.style.alignItems = 'center';
			childItem.style.padding = '2px 8px';
			childItem.style.borderRadius = '3px';
			childItem.style.marginBottom = '1px';
			childItem.style.cursor = 'pointer';
			childItem.style.fontSize = '13px';
			childItem.style.position = 'relative';

			// 悬停效果
			childItem.addEventListener('mouseenter', () => {
				childItem.style.backgroundColor = 'var(--background-modifier-hover)';
			});
			childItem.addEventListener('mouseleave', () => {
				childItem.style.backgroundColor = 'transparent';
			});

			// 图标
			const icon = childItem.createEl('span', {
				cls: 'item-icon'
			});
			if (child instanceof TFolder) {
				icon.textContent = '📁';
				icon.style.marginRight = '4px';
				icon.style.fontSize = '12px';
			} else {
				icon.textContent = '📄';
				icon.style.marginRight = '4px';
				icon.style.fontSize = '12px';
			}

			// 名称
			const name = childItem.createEl('span', {
				text: child.name,
				cls: 'item-name'
			});
			name.style.flex = '1';
			name.style.color = 'var(--text-normal)';

			// 点击事件
			childItem.addEventListener('click', (e) => {
				e.stopPropagation();
				if (child instanceof TFile) {
					// 打开文件
					this.plugin.app.workspace.openLinkText(child.path, '');
				} else if (child instanceof TFolder) {
					// 递归展开子文件夹
					this.toggleSubFolderExpansion(childItem, child.path, child);
				}
			});

			// 如果是文件夹，添加展开箭头
			if (child instanceof TFolder) {
				const expandIcon = childItem.createEl('span', {
					cls: 'sub-expand-icon',
					text: '▶'
				});
				expandIcon.style.marginLeft = '4px';
				expandIcon.style.fontSize = '10px';
				expandIcon.style.color = 'var(--text-muted)';
			}
		});
	}

	toggleSubFolderExpansion(subFolderItem, folderPath, folder) {
		const isExpanded = subFolderItem.hasClass('expanded');
		
		if (isExpanded) {
			// 折叠子文件夹
			subFolderItem.removeClass('expanded');
			const expandIcon = subFolderItem.querySelector('.sub-expand-icon');
			if (expandIcon) {
				expandIcon.textContent = '▶';
			}
			
			const subContainer = subFolderItem.parentElement.querySelector(`.sub-sub-container[data-path="${folderPath}"]`);
			if (subContainer) {
				subContainer.style.display = 'none';
			}
		} else {
			// 展开子文件夹
			subFolderItem.addClass('expanded');
			const expandIcon = subFolderItem.querySelector('.sub-expand-icon');
			if (expandIcon) {
				expandIcon.textContent = '▼';
			}

			// 创建子子容器
			let subSubContainer = subFolderItem.parentElement.querySelector(`.sub-sub-container[data-path="${folderPath}"]`);
			if (!subSubContainer) {
				subSubContainer = subFolderItem.parentElement.createDiv('sub-sub-container');
				subSubContainer.setAttribute('data-path', folderPath);
				subSubContainer.style.marginLeft = '20px';
				subSubContainer.style.marginTop = '2px';
				subSubContainer.style.borderLeft = '1px solid var(--background-modifier-border)';
				subSubContainer.style.paddingLeft = '6px';
				
				subFolderItem.parentElement.insertBefore(subSubContainer, subFolderItem.nextSibling);
			}

			// 渲染子子内容
			this.renderSubFolderContent(subSubContainer, folder);
		}
	}

	sortWithPinnedFolders(items) {
		const sortedItems = this.originalSort.call(this.fileExplorer, items);
		
		if (!this.plugin.settings.groupPinnedFolders) {
			return sortedItems;
		}

		// 分离固定和非固定项目
		const pinnedItems = [];
		const unpinnedItems = [];

		sortedItems.forEach(item => {
			if (this.isPinned(item.file)) {
				pinnedItems.push(item);
			} else {
				unpinnedItems.push(item);
			}
		});

		// 按固定顺序排序固定项目
		pinnedItems.sort((a, b) => {
			const aOrder = this.getPinOrder(a.file.path);
			const bOrder = this.getPinOrder(b.file.path);
			return aOrder - bOrder;
		});

		return [...pinnedItems, ...unpinnedItems];
	}

	addPinIcons() {
		if (!this.plugin.settings.showPinIcon || !this.fileExplorer) return;

		const fileItems = this.fileExplorer.fileItems;
		if (!fileItems) return;

		Object.values(fileItems).forEach((item) => {
			if (item && item.file && item.titleEl) {
				if (this.isPinned(item.file) && item.file instanceof TFolder) {
					this.addPinIconToItem(item);
				} else {
					this.removePinIconFromItem(item);
				}
			}
		});
	}

	addPinIconToItem(item) {
		if (item.titleEl.querySelector('.pin-icon')) return;

		const pinIcon = item.titleEl.createEl('span', {
			cls: 'pin-icon',
			text: '📌'
		});
		pinIcon.style.marginRight = '4px';
		pinIcon.style.fontSize = '12px';
		pinIcon.title = 'Pinned folder';
	}

	removePinIconFromItem(item) {
		const pinIcon = item.titleEl.querySelector('.pin-icon');
		if (pinIcon) {
			pinIcon.remove();
		}
	}

	addContextMenu() {
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFolder) {
					const isPinned = this.isPinned(file);
					menu.addItem(item => {
						item
							.setTitle(isPinned ? 'Unpin folder' : 'Pin folder')
							.setIcon(isPinned ? 'bookmark-minus' : 'bookmark-plus')
							.onClick(() => {
								this.togglePin(file.path);
							});
					});
				}
			})
		);
	}

	togglePin(folderPath) {
		const isPinned = this.isPinned(folderPath);
		
		if (isPinned) {
			this.unpinFolder(folderPath);
			new Notice(`Unpinned folder: ${folderPath}`);
		} else {
			this.pinFolder(folderPath);
			new Notice(`Pinned folder: ${folderPath}`);
		}

		this.plugin.saveSettings();
		this.refreshFileExplorer();
	}

	pinFolder(folderPath) {
		if (!this.plugin.settings.pinnedFolders.includes(folderPath)) {
			this.plugin.settings.pinnedFolders.push(folderPath);
			this.plugin.settings.sortOrder.push(folderPath);
		}
	}

	unpinFolder(folderPath) {
		this.plugin.settings.pinnedFolders = this.plugin.settings.pinnedFolders.filter(
			path => path !== folderPath
		);
		this.plugin.settings.sortOrder = this.plugin.settings.sortOrder.filter(
			path => path !== folderPath
		);
	}

	unpinAll() {
		this.plugin.settings.pinnedFolders = [];
		this.plugin.settings.sortOrder = [];
		this.plugin.saveSettings();
		this.refreshFileExplorer();
		new Notice('All folders unpinned');
	}

	isPinned(fileOrPath) {
		const path = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
		return this.plugin.settings.pinnedFolders.includes(path);
	}

	getPinOrder(folderPath) {
		const index = this.plugin.settings.sortOrder.indexOf(folderPath);
		return index === -1 ? 999 : index;
	}

	movePinOrder(fromIndex, toIndex) {
		const item = this.plugin.settings.sortOrder.splice(fromIndex, 1)[0];
		this.plugin.settings.sortOrder.splice(toIndex, 0, item);
		this.plugin.saveSettings();
		this.refreshFileExplorer();
	}

	refreshFileExplorer() {
		if (this.fileExplorer) {
			// 强制重新排序
			if (this.fileExplorer.requestSort) {
				this.fileExplorer.requestSort();
			}
			// 延迟添加图标和固定文件夹容器
			setTimeout(() => {
				this.addPinIcons();
				this.addPinnedFoldersToTop();
			}, 500);
		}
	}

	cleanup() {
		if (this.fileExplorer && this.originalSort) {
			this.fileExplorer.sort = this.originalSort;
		}
	}
}

// 设置标签页类
class SettingsTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Pin Folder Settings' });

		// 显示固定图标设置 - 已移除
		// new Setting(containerEl)
		// 	.setName('Show pin icon')
		// 	.setDesc('Display a pin icon next to pinned folders')
		// 	.addToggle(toggle => toggle
		// 		.setValue(this.plugin.settings.showPinIcon)
		// 		.onChange(async (value) => {
		// 			this.plugin.settings.showPinIcon = value;
		// 			await this.plugin.saveSettings();
		// 		}));

		// 启用拖拽排序设置 - 已移除
		// new Setting(containerEl)
		// 	.setName('Enable drag sorting')
		// 	.setDesc('Allow dragging to reorder pinned folders')
		// 	.addToggle(toggle => toggle
		// 		.setValue(this.plugin.settings.enableDragSort)
		// 		.onChange(async (value) => {
		// 			this.plugin.settings.enableDragSort = value;
		// 			await this.plugin.saveSettings();
		// 		}));

		// 分组固定文件夹设置 - 已移除
		// new Setting(containerEl)
		// 	.setName('Group pinned folders')
		// 	.setDesc('Show pinned folders at the top of the file explorer')
		// 	.addToggle(toggle => toggle
		// 		.setValue(this.plugin.settings.groupPinnedFolders)
		// 		.onChange(async (value) => {
		// 			this.plugin.settings.groupPinnedFolders = value;
		// 			await this.plugin.saveSettings();
		// 			// 立即刷新显示
		// 			if (this.plugin.pinManager) {
		// 				this.plugin.pinManager.refreshFileExplorer();
		// 			}
		// 		}));

		// 固定文件夹列表
		containerEl.createEl('h3', { text: 'Pinned Folders' });
		
		const pinnedFoldersContainer = containerEl.createDiv('pinned-folders-container');
		this.renderPinnedFoldersList(pinnedFoldersContainer);

		// 操作按钮
		const buttonContainer = containerEl.createDiv('button-container');
		buttonContainer.style.marginTop = '20px';

		new Setting(buttonContainer)
			.setName('Clear all pinned folders')
			.setDesc('Remove all pinned folders')
			.addButton(button => button
				.setButtonText('Clear All')
				.setCta()
				.onClick(async () => {
					if (confirm('Are you sure you want to unpin all folders?')) {
						this.plugin.settings.pinnedFolders = [];
						this.plugin.settings.sortOrder = [];
						await this.plugin.saveSettings();
						this.renderPinnedFoldersList(pinnedFoldersContainer);
					}
				}));

		// 导入/导出设置 - 已移除
		// containerEl.createEl('h3', { text: 'Import/Export' });

		// new Setting(containerEl)
		// 	.setName('Export settings')
		// 	.setDesc('Export pinned folders configuration')
		// 	.addButton(button => button
		// 		.setButtonText('Export')
		// 		.onClick(() => {
		// 			this.exportSettings();
		// 		}));

		// new Setting(containerEl)
		// 	.setName('Import settings')
		// 	.setDesc('Import pinned folders configuration')
		// 	.addButton(button => button
		// 		.setButtonText('Import')
		// 		.onClick(() => {
		// 			this.importSettings();
		// 		}));
	}

	renderPinnedFoldersList(container) {
		container.empty();

		if (this.plugin.settings.pinnedFolders.length === 0) {
			container.createEl('p', { 
				text: 'No pinned folders. Right-click on a folder in the file explorer to pin it.',
				cls: 'no-pinned-folders'
			});
			return;
		}

		// 创建固定文件夹列表
		const listContainer = container.createDiv('pinned-folders-list');
		
		this.plugin.settings.sortOrder.forEach((folderPath, index) => {
			if (!this.plugin.settings.pinnedFolders.includes(folderPath)) {
				return;
			}

			const folderItem = listContainer.createDiv('pinned-folder-item');
			folderItem.style.display = 'flex';
			folderItem.style.alignItems = 'center';
			folderItem.style.padding = '8px';
			folderItem.style.border = '1px solid var(--background-modifier-border)';
			folderItem.style.borderRadius = '4px';
			folderItem.style.marginBottom = '4px';

			// 文件夹路径
			const pathEl = folderItem.createDiv('folder-path');
			pathEl.textContent = folderPath;
			pathEl.style.flex = '1';
			pathEl.style.fontFamily = 'var(--font-monospace)';
			pathEl.style.fontSize = '12px';

			// 上移按钮
			const upButton = folderItem.createEl('button', { text: '↑' });
			upButton.style.marginRight = '4px';
			upButton.disabled = index === 0;
			upButton.onclick = () => {
				if (index > 0) {
					this.moveFolder(index, index - 1);
					this.renderPinnedFoldersList(container);
				}
			};

			// 下移按钮
			const downButton = folderItem.createEl('button', { text: '↓' });
			downButton.style.marginRight = '4px';
			downButton.disabled = index === this.plugin.settings.pinnedFolders.length - 1;
			downButton.onclick = () => {
				if (index < this.plugin.settings.pinnedFolders.length - 1) {
					this.moveFolder(index, index + 1);
					this.renderPinnedFoldersList(container);
				}
			};

			// 取消固定按钮
			const unpinButton = folderItem.createEl('button', { text: 'Unpin' });
			unpinButton.style.color = 'var(--text-error)';
			unpinButton.onclick = async () => {
				this.plugin.settings.pinnedFolders = this.plugin.settings.pinnedFolders.filter(
					path => path !== folderPath
				);
				this.plugin.settings.sortOrder = this.plugin.settings.sortOrder.filter(
					path => path !== folderPath
				);
				await this.plugin.saveSettings();
				this.renderPinnedFoldersList(container);
			};
		});
	}

	async moveFolder(fromIndex, toIndex) {
		const item = this.plugin.settings.sortOrder.splice(fromIndex, 1)[0];
		this.plugin.settings.sortOrder.splice(toIndex, 0, item);
		await this.plugin.saveSettings();
	}
}

module.exports = PinFolderPlugin;

module.exports = PinFolderPlugin;