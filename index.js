// @ts-nocheck
// Author: discord千秋梦
// Version: v1.1

function getSillyTavernContext() {
    if (window.parent && window.parent.SillyTavern) {
        return window.parent.SillyTavern.getContext();
    }
    if (window.SillyTavern) {
        return window.SillyTavern.getContext();
    }
    throw new Error('无法获取SillyTavern上下文');
}

function getParentWindow() {
    return window.parent && window.parent !== window ? window.parent : window;
}

function getJQuery() {
    const parentWindow = getParentWindow();
    if (parentWindow.$) {
        return parentWindow.$;
    }
    if (window.$) {
        return window.$;
    }
    throw new Error('jQuery未找到');
}

function getCurrentApiInfo() {
    try {
        const context = getSillyTavernContext();
        const mainApi = context.mainApi;
        const presetManager = context.getPresetManager(mainApi === 'koboldhorde' ? 'kobold' : mainApi);
        if (!presetManager) {
            throw new Error(`无法获取预设管理器: ${mainApi}`);
        }
        const { preset_names } = presetManager.getPresetList();
        const presetNames = Array.isArray(preset_names) ? preset_names : Object.keys(preset_names);
        return {
            apiType: mainApi,
            presetManager: presetManager,
            presetNames: presetNames,
            context: context
        };
    } catch (error) {
        console.error('获取API信息失败:', error);
        return null;
    }
}

function getPresetDataFromManager(apiInfo, presetName) {
    try {
        const presetData = apiInfo.presetManager.getCompletionPresetByName(presetName);
        if (!presetData) {
            throw new Error(`预设 "${presetName}" 不存在`);
        }
        return presetData;
    } catch (error) {
        console.error('从预设管理器获取预设数据失败:', error);
        throw error;
    }
}

function getPromptEntries(presetData) {
    if (!presetData || !presetData.prompts || !Array.isArray(presetData.prompts)) {
        return [];
    }
    return presetData.prompts.filter(prompt =>
        prompt &&
        !prompt.system_prompt &&
        !prompt.marker &&
        prompt.name &&
        prompt.name.trim() !== ''
    );
}

function getOrderedPromptEntries(presetData, displayMode = 'default') {
    if (!presetData || !presetData.prompts || !Array.isArray(presetData.prompts)) {
        return [];
    }

    const dummyCharacterId = 100001;
    const characterPromptOrder = presetData.prompt_order?.find(order => order.character_id === dummyCharacterId);
    const orderMap = new Map(characterPromptOrder?.order.map(o => [o.identifier, o.enabled]));

    // If no specific order is defined, fall back to returning all prompts.
    if (!characterPromptOrder) {
        return getPromptEntries(presetData).map(entry => ({ ...entry, enabled: false }));
    }

    const orderedEntries = [];
    const promptMap = new Map(presetData.prompts.map(p => [p.identifier, p]));

    characterPromptOrder.order.forEach(orderEntry => {
        // For 'default' mode, only process enabled entries.
        // For 'include_disabled' mode, process all entries in the order.
        if (displayMode === 'default' && !orderEntry.enabled) {
            return; // Skip disabled entries in default mode
        }

        if (promptMap.has(orderEntry.identifier)) {
            const prompt = promptMap.get(orderEntry.identifier);
            // Filter out system prompts, markers, and empty names.
            if (prompt && !prompt.system_prompt && !prompt.marker && prompt.name && prompt.name.trim() !== '') {
                orderedEntries.push({
                    ...prompt,
                    enabled: orderEntry.enabled, // Always include the enabled status
                    orderIndex: orderedEntries.length
                });
            }
        }
    });

    return orderedEntries;
}

function getNewEntries(leftPresetData, rightPresetData, side) {
    if (!leftPresetData || !rightPresetData) {
        return [];
    }

    const leftEntries = getPromptEntries(leftPresetData);
    const rightEntries = getPromptEntries(rightPresetData);

    // 创建名称映射
    const leftNames = new Set(leftEntries.map(e => e.name));
    const rightNames = new Set(rightEntries.map(e => e.name));

    if (side === 'left') {
        // 返回左侧独有的条目（右侧没有的）
        return leftEntries.filter(entry => !rightNames.has(entry.name))
            .map(entry => ({ ...entry, enabled: false, isNewEntry: true }));
    } else if (side === 'right') {
        // 返回右侧独有的条目（左侧没有的）
        return rightEntries.filter(entry => !leftNames.has(entry.name))
            .map(entry => ({ ...entry, enabled: false, isNewEntry: true }));
    }

    return [];
}

function toggleNewEntries(apiInfo, side) {
    const $ = getJQuery();
    const leftPreset = $('#left-preset').val();
    const rightPreset = $('#right-preset').val();
    const button = $(`#${side}-show-new`);

    if (!leftPreset || !rightPreset || leftPreset === rightPreset) {
        alert('请选择两个不同的预设才能查看新增条目');
        return;
    }

    // 检查当前是否在新增模式
    const isShowingNew = button.hasClass('showing-new');

    if (isShowingNew) {
        // 关闭新增模式，显示所有条目
        button.removeClass('showing-new');
        button.find('.btn-icon').text('🆕');

        // 恢复搜索状态（如果之前有搜索）
        const searchValue = $(`#${side}-entry-search-inline`).val();
        if (searchValue) {
            // 有搜索条件，应用搜索过滤
            setTimeout(() => {
                filterSideEntries(side, searchValue);
            }, 50);
        } else {
            // 没有搜索条件，显示所有条目（除了位置项）
            $(`#${side}-entries-list .entry-item`).each(function() {
                const $item = $(this);
                if (!$item.hasClass('position-item')) {
                    $item.show();
                }
            });
        }

        // 恢复原始标题
        const presetName = side === 'left' ? leftPreset : rightPreset;
        const entries = side === 'left' ? window.leftEntries : window.rightEntries;
        $(`#${side}-preset-title`).text(`${side === 'left' ? '左侧' : '右侧'}预设: ${presetName}`);

        // 取消所有选择
        setTimeout(() => {
            $(`#${side}-entries-list .entry-checkbox`).prop('checked', false);
            updateDualSelectionCount();
        }, 50);

    } else {
        // 开启新增模式
        try {
            const leftData = getPresetDataFromManager(apiInfo, leftPreset);
            const rightData = getPresetDataFromManager(apiInfo, rightPreset);

            // 获取所有新增条目的标识符
            const allNewEntries = getNewEntries(leftData, rightData, side);
            const newEntryIdentifiers = new Set(allNewEntries.map(entry => entry.identifier));

            if (newEntryIdentifiers.size === 0) {
                alert(`${side === 'left' ? '左侧' : '右侧'}预设没有独有的新增条目`);
                return;
            }

            // 标记按钮状态
            button.addClass('showing-new');
            button.find('.btn-icon').text('❌');

            let visibleNewCount = 0;
            const searchValue = $(`#${side}-entry-search-inline`).val();
            const searchTerm = searchValue ? searchValue.toLowerCase() : '';

            // 隐藏非新增条目，对新增条目应用搜索过滤
            $(`#${side}-entries-list .entry-item`).each(function() {
                const $item = $(this);
                if (!$item.hasClass('position-item')) {
                    const identifier = $item.data('identifier');
                    if (newEntryIdentifiers.has(identifier)) {
                        // 这是新增条目，检查是否匹配搜索条件
                        if (searchTerm) {
                            const name = $item.find('.entry-name').text().toLowerCase();
                            const matches = name.includes(searchTerm);
                            if (matches) {
                                $item.show();
                                visibleNewCount++;
                                // 添加跳转按钮（如果需要）
                                addJumpButton($item);
                            } else {
                                $item.hide();
                            }
                        } else {
                            // 没有搜索条件，显示所有新增条目
                            $item.show();
                            visibleNewCount++;
                        }
                    } else {
                        // 非新增条目，隐藏
                        $item.hide();
                    }
                }
            });

            // 更新标题显示新增条目数量
            const presetName = side === 'left' ? leftPreset : rightPreset;
            $(`#${side}-preset-title`).text(`${side === 'left' ? '左侧' : '右侧'}预设: ${presetName} (新增: ${visibleNewCount})`);

            // 如果没有可见的新增条目，给出提示
            if (visibleNewCount === 0) {
                if (searchTerm) {
                    alert(`在搜索"${searchValue}"的结果中，${side === 'left' ? '左侧' : '右侧'}预设没有匹配的新增条目`);
                } else {
                    alert(`${side === 'left' ? '左侧' : '右侧'}预设没有独有的新增条目`);
                }
                // 恢复按钮状态
                button.removeClass('showing-new');
                button.find('.btn-icon').text('🆕');
                return;
            }

        } catch (error) {
            console.error('显示新增条目失败:', error);
            alert('显示新增条目失败: ' + error.message);
        }
    }
}

function calculateStringSimilarity(str1, str2) {
    // 计算两个字符串的相似度（使用多种算法组合）
    if (!str1 || !str2) return 0;

    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();

    if (s1 === s2) return 1;

    // 1. 包含关系检查（权重较高）
    if (s1.includes(s2) || s2.includes(s1)) {
        const shorter = s1.length < s2.length ? s1 : s2;
        const longer = s1.length >= s2.length ? s1 : s2;
        return 0.8 + (shorter.length / longer.length) * 0.2; // 0.8-1.0
    }

    // 2. 关键词匹配
    const keywords1 = s1.split(/[\s\-_]+/).filter(w => w.length > 0);
    const keywords2 = s2.split(/[\s\-_]+/).filter(w => w.length > 0);

    let keywordMatches = 0;
    for (const kw1 of keywords1) {
        for (const kw2 of keywords2) {
            if (kw1 === kw2 || kw1.includes(kw2) || kw2.includes(kw1)) {
                keywordMatches++;
                break;
            }
        }
    }

    const keywordSimilarity = keywordMatches / Math.max(keywords1.length, keywords2.length);
    if (keywordSimilarity > 0.5) {
        return 0.6 + keywordSimilarity * 0.3; // 0.6-0.9
    }

    // 3. 编辑距离算法（用于细微差异）
    const len1 = s1.length;
    const len2 = s2.length;

    if (len1 === 0) return len2 === 0 ? 1 : 0;
    if (len2 === 0) return 0;

    // 创建距离矩阵
    const matrix = Array(len1 + 1).fill().map(() => Array(len2 + 1).fill(0));

    // 初始化第一行和第一列
    for (let i = 0; i <= len1; i++) matrix[i][0] = i;
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;

    // 填充矩阵
    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,      // 删除
                matrix[i][j - 1] + 1,      // 插入
                matrix[i - 1][j - 1] + cost // 替换
            );
        }
    }

    const maxLen = Math.max(len1, len2);
    const editSimilarity = (maxLen - matrix[len1][len2]) / maxLen;

    return editSimilarity;
}

function findBestInsertPosition(selectedEntries, targetEntries) {
    // 为每个选中的条目找到最佳插入位置
    const results = [];

    for (const selectedEntry of selectedEntries) {
        let bestMatch = null;
        let bestSimilarity = 0;
        let bestPosition = 'bottom'; // 默认插入到底部
        let bestIndex = -1;

        console.log(`\n分析条目: "${selectedEntry.name}"`);

        // 检查与目标条目的相似度
        for (let i = 0; i < targetEntries.length; i++) {
            const targetEntry = targetEntries[i];
            const similarity = calculateStringSimilarity(selectedEntry.name, targetEntry.name);

            console.log(`  与 "${targetEntry.name}" 的相似度: ${Math.round(similarity * 100)}%`);

            // 降低阈值到0.2，并优先选择相似度最高的
            if (similarity > bestSimilarity && similarity > 0.2) {
                bestSimilarity = similarity;
                bestMatch = targetEntry;
                bestPosition = `after-${i}`;
                bestIndex = i;
            }
        }

        // 如果没有找到相似的，尝试查找同类型的条目（如都包含"文风"）
        if (!bestMatch) {
            const selectedKeywords = selectedEntry.name.toLowerCase().match(/[\u4e00-\u9fa5]+|[a-zA-Z]+/g) || [];

            for (let i = 0; i < targetEntries.length; i++) {
                const targetEntry = targetEntries[i];
                const targetKeywords = targetEntry.name.toLowerCase().match(/[\u4e00-\u9fa5]+|[a-zA-Z]+/g) || [];

                // 检查是否有共同关键词
                const hasCommonKeyword = selectedKeywords.some(sk =>
                    targetKeywords.some(tk => sk === tk || sk.includes(tk) || tk.includes(sk))
                );

                if (hasCommonKeyword) {
                    bestMatch = targetEntry;
                    bestSimilarity = 0.25; // 给一个基础相似度
                    bestPosition = `after-${i}`;
                    bestIndex = i;
                    console.log(`  通过关键词匹配找到: "${targetEntry.name}"`);
                    break;
                }
            }
        }

        console.log(`  最终选择: ${bestMatch ? `"${bestMatch.name}" (${Math.round(bestSimilarity * 100)}%)` : '插入到底部'}`);

        results.push({
            entry: selectedEntry,
            bestMatch: bestMatch,
            similarity: bestSimilarity,
            position: bestPosition,
            positionText: bestMatch ? `插入到 "${bestMatch.name}" 之后 (相似度: ${Math.round(bestSimilarity * 100)}%)` : '插入到底部 (未找到相似条目)'
        });
    }

    return results;
}

function getDeviceInfo() {
    const parentWindow = getParentWindow();
    const isMobile = parentWindow.innerWidth <= 768;
    const isSmallScreen = parentWindow.innerWidth <= 480;
    const isPortrait = parentWindow.innerHeight > parentWindow.innerWidth;
    return { isMobile, isSmallScreen, isPortrait };
}

// 新版本字段处理
const NEW_FIELD_DEFAULTS = {
    injection_order: 100,
    injection_trigger: [],
};

const TRIGGER_TYPES = [
    'normal', 'continue', 'impersonate', 'swipe', 'regenerate', 'quiet',
];

const TRIGGER_TYPE_LABELS = {
    'normal': '正常',
    'continue': '继续',
    'impersonate': 'AI 帮答',
    'swipe': 'Swipe',
    'regenerate': '重新生成',
    'quiet': 'Quiet',
};

function hasNewVersionFields(entry) {
    return entry.hasOwnProperty('injection_order') || entry.hasOwnProperty('injection_trigger');
}

function extractNewVersionFields(sourceEntry) {
    const newFields = {};
    if (sourceEntry.hasOwnProperty('injection_order')) {
        newFields.injection_order = sourceEntry.injection_order;
    }
    if (sourceEntry.hasOwnProperty('injection_trigger')) {
        newFields.injection_trigger = Array.isArray(sourceEntry.injection_trigger) ? [...sourceEntry.injection_trigger] : [];
    }
    return newFields;
}

function applyNewVersionFields(targetEntry, newFields) {
    if (newFields.hasOwnProperty('injection_order')) {
        targetEntry.injection_order = newFields.injection_order;
    } else if (!targetEntry.hasOwnProperty('injection_order')) {
        targetEntry.injection_order = NEW_FIELD_DEFAULTS.injection_order;
    }
    if (newFields.hasOwnProperty('injection_trigger')) {
        targetEntry.injection_trigger = [...newFields.injection_trigger];
    } else if (!targetEntry.hasOwnProperty('injection_trigger')) {
        targetEntry.injection_trigger = [...NEW_FIELD_DEFAULTS.injection_trigger];
    }
    return targetEntry;
}

function transferEntryWithNewFields(sourceEntry, targetEntry = null) {
    if (!targetEntry) {
        targetEntry = {
            identifier: sourceEntry.identifier,
            name: sourceEntry.name,
            role: sourceEntry.role,
            content: sourceEntry.content,
            system_prompt: sourceEntry.system_prompt || false,
            injection_position: sourceEntry.injection_position,
            injection_depth: sourceEntry.injection_depth,
            forbid_overrides: sourceEntry.forbid_overrides || false,
        };
    }
    const newFields = extractNewVersionFields(sourceEntry);
    return applyNewVersionFields(targetEntry, newFields);
}

function batchTransferWithNewFields(sourceEntries) {
    return sourceEntries.map(sourceEntry => transferEntryWithNewFields(sourceEntry));
}

function createEntryWithNewFields(entryData, options = {}) {
    const entry = {
        identifier: entryData.identifier || generateUUID(),
        name: entryData.name || '',
        role: entryData.role || 'system',
        content: entryData.content || '',
        system_prompt: entryData.system_prompt || false,
        injection_position: entryData.injection_position,
        injection_depth: entryData.injection_depth ?? 4,
        forbid_overrides: entryData.forbid_overrides || false,
        injection_order: options.order ?? NEW_FIELD_DEFAULTS.injection_order,
        injection_trigger: options.triggers ? [...options.triggers] : [...NEW_FIELD_DEFAULTS.injection_trigger],
    };
    return entry;
}

function sortEntriesByOrder(entries) {
    return entries.slice().sort((a, b) => {
        const orderA = a.injection_order ?? NEW_FIELD_DEFAULTS.injection_order;
        const orderB = b.injection_order ?? NEW_FIELD_DEFAULTS.injection_order;
        return orderA - orderB;
    });
}

function ensureNewVersionFields(entry) {
    const updatedEntry = { ...entry };
    if (!updatedEntry.hasOwnProperty('injection_order')) {
        updatedEntry.injection_order = NEW_FIELD_DEFAULTS.injection_order;
    }
    if (!updatedEntry.hasOwnProperty('injection_trigger')) {
        updatedEntry.injection_trigger = [...NEW_FIELD_DEFAULTS.injection_trigger];
    }
    return updatedEntry;
}

function ensureAllEntriesHaveNewFields(entries) {
    return entries.map(entry => ensureNewVersionFields(entry));
}

// 主题相关功能
function isDarkTheme() {
    try {
        const context = getSillyTavernContext();
        const theme = context.powerUserSettings?.theme;
        const blurTint = context.powerUserSettings?.blur_tint_color;

        if (theme !== undefined) {
            const themeStr = String(theme).toLowerCase();
            return themeStr.includes('dark') ||
                   themeStr.includes('midnight') ||
                   themeStr.includes('black') ||
                   (blurTint && blurTint.includes('23, 23, 23'));
        }
    } catch (error) {
        console.warn('Could not get SillyTavern context for theme detection.', error);
    }

    // Fallback to CSS detection
    try {
        const $ = getJQuery();
        const bodyBg = $('body').css('background-color');
        if (bodyBg) {
            const rgb = bodyBg.match(/\d+/g);
            if (rgb && rgb.length >= 3) {
                const brightness = (parseInt(rgb[0]) * 299 + parseInt(rgb[1]) * 587 + parseInt(rgb[2]) * 114) / 1000;
                return brightness < 128;
            }
        }

        // Additional CSS checks
        const rootBg = $(':root').css('background-color') || $('html').css('background-color');
        if (rootBg && rootBg !== 'rgba(0, 0, 0, 0)') {
            const rgb = rootBg.match(/\d+/g);
            if (rgb && rgb.length >= 3) {
                const brightness = (parseInt(rgb[0]) * 299 + parseInt(rgb[1]) * 587 + parseInt(rgb[2]) * 114) / 1000;
                return brightness < 128;
            }
        }
    } catch (error) {
        console.warn('Theme detection by CSS failed.', error);
    }

    console.log('主题检测失败，使用默认浅色主题');
    return false;
}

function toggleTransferToolTheme() {
    try {
        const context = getSillyTavernContext();

        if (!context || !context.powerUserSettings) {
            console.warn('无法访问 powerUserSettings，跳过主题切换');
            return;
        }

        const isDark = isDarkTheme();
        const newTheme = isDark ? 'Default' : 'Dark Lite';

        // Use SillyTavern existing API to switch themes
        context.powerUserSettings.theme = newTheme;

        const parentWindow = getParentWindow();
        if (parentWindow.applyTheme) {
            parentWindow.applyTheme(newTheme);
        } else if (parentWindow.switchTheme) {
            parentWindow.switchTheme(newTheme);
        }

        if (parentWindow.saveSettingsDebounced) {
            parentWindow.saveSettingsDebounced();
        } else if (parentWindow.saveSettings) {
            parentWindow.saveSettings();
        }

        console.log(`主题已切换到: ${newTheme}`);
    } catch (error) {
        console.error('主题切换失败:', error);
        // 不显示alert，只在控制台记录错误
        console.warn('主题切换失败，请手动在设置中切换主题');
    }
}

function updateThemeButton() {
    const $ = getJQuery();
    const themeBtn = $('#theme-toggle-btn');
    if (themeBtn.length) {
        const isDark = isDarkTheme();
        themeBtn.html(isDark ? '☀️' : '🌙');
        themeBtn.attr('title', isDark ? '切换到浅色主题' : '切换到深色主题');
    }
}

function updateModalTheme() {
    const $ = getJQuery();
    const modal = $('#preset-transfer-modal');
    if (!modal.length) return;

    const { isMobile, isSmallScreen, isPortrait } = getDeviceInfo();

    // --- Handle open sub-modals ---
    const compareModal = $('#compare-modal');
    let compareModalData = null;
    if (compareModal.length) {
        compareModalData = compareModal.data();
        compareModal.remove();
    }

    const editModal = $('#edit-entry-modal');
    let editModalData = null;
    if (editModal.length) {
        editModalData = editModal.data();
        editModal.remove();
    }
    // --- End handle sub-modals ---

    // 移除旧的样式
    $('#preset-transfer-styles').remove();
    $('#edit-entry-modal-styles').remove();
    $('#compare-modal-styles').remove();

    // 重新应用主模态框样式
    applyStyles(isMobile, isSmallScreen, isPortrait);

    // --- Recreate sub-modals if they were open ---
    if (editModalData && editModalData.apiInfo) {
        createEditEntryModal(editModalData.apiInfo, editModalData.presetName, editModalData.entry, editModalData.insertPosition, editModalData.autoEnable, editModalData.side, null, editModalData.displayMode);
    }

    if (compareModalData && compareModalData.apiInfo) {
        createCompareModal(compareModalData.apiInfo, compareModalData.leftPreset, compareModalData.rightPreset, compareModalData.commonEntries);
    }
    // --- End recreate sub-modals ---

    // 更新主题按钮
    updateThemeButton();

    // 如果条目已加载，则重新加载它们以应用主题
    if ($('#entries-container').is(':visible')) {
        const apiInfo = getCurrentApiInfo();
        if (apiInfo) {
            loadAndDisplayEntries(apiInfo);
        }
    }
}

function initializeThemeSettings() {
    try {
        const context = getSillyTavernContext();

        // 如果是首次使用或者主题未设置，确保使用浅色主题
        if (!context.powerUserSettings?.theme || context.powerUserSettings.theme === '') {
            console.log('首次使用预设转移工具，设置默认浅色主题');
            context.powerUserSettings.theme = 'Default';

            const parentWindow = getParentWindow();
            if (parentWindow.applyTheme) {
                parentWindow.applyTheme('Default');
            }
            if (parentWindow.saveSettingsDebounced) {
                parentWindow.saveSettingsDebounced();
            }
        }
    } catch (error) {
        console.log('主题初始化跳过:', error.message);
    }
}

// 设置存储功能
const STORAGE_KEY = 'preset-transfer-settings';

function getDefaultSettings() {
    return {
        autoCloseModal: true,
        autoEnableEntry: true,
        leftDisplayMode: 'default',
        rightDisplayMode: 'default',
        singleDisplayMode: 'default',
    };
}

function saveTransferSettings(settings) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
        console.warn('保存设置失败:', error);
    }
}

function loadTransferSettings() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved ? { ...getDefaultSettings(), ...JSON.parse(saved) } : getDefaultSettings();
    } catch (error) {
        console.warn('加载设置失败，使用默认设置:', error);
        return getDefaultSettings();
    }
}

function createTransferUI() {
    console.log('开始创建转移UI...');

    // 初始化主题设置
    initializeThemeSettings();

    const apiInfo = getCurrentApiInfo();
    if (!apiInfo) {
        console.error('无法获取API信息');
        alert('无法获取当前API信息，请确保SillyTavern已正确加载');
        return;
    }
    console.log('API信息获取成功，预设数量:', apiInfo.presetNames.length);
    if (apiInfo.presetNames.length < 1) {
        alert('至少需要1个预设才能进行操作');
        return;
    }

    const $ = getJQuery();
    const { isMobile, isSmallScreen, isPortrait } = getDeviceInfo();

    const modalHtml = `
        <div id="preset-transfer-modal">
            <div class="transfer-modal-content">
                <div class="modal-header">
                    <button id="theme-toggle-btn" class="theme-toggle-btn" title="切换主题">🌙</button>
                    <div>
                        <span>🔄</span>
                        <h2>预设条目转移工具</h2>
                    </div>
                    <div class="version-info">
                        <span class="author">V1.1 by discord千秋梦</span>
                    </div>
                </div>
                <div class="preset-selection">
                    <div class="preset-field">
                        <label>
                            <span><span>📋</span> 左侧预设</span>
                            <span>选择要管理的预设</span>
                        </label>
                        <select id="left-preset">
                            <option value="">请选择预设</option>
                            ${apiInfo.presetNames.map(name => `<option value="${name}">${name}</option>`).join('')}
                        </select>
                    </div>
                    <div class="preset-field">
                        <label>
                            <span><span>📋</span> 右侧预设</span>
                            <span>选择要管理的预设</span>
                        </label>
                        <select id="right-preset">
                            <option value="">请选择预设</option>
                            ${apiInfo.presetNames.map(name => `<option value="${name}">${name}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="action-section">
                    <button id="load-entries" disabled>📋 加载条目</button>
                    <label class="auto-switch-label">
                        <input type="checkbox" id="auto-close-modal" checked>
                        <span>完成后自动关闭</span>
                    </label>
                    <label class="auto-switch-label">
                        <input type="checkbox" id="auto-enable-entry" checked>
                        <span>插入后自动开启</span>
                    </label>
                </div>
                <div id="entries-container" style="display: none;">
                    <div class="entries-header">
                        <h4>📝 双向预设管理</h4>
                        <p>💡 提示：左右两侧显示不同预设的条目，可以互相转移、编辑、删除和新建</p>
                        <div class="search-section">
                            <input type="text" id="entry-search" placeholder="🔍 搜索条目...">
                            <div class="left-search-section" style="display: none;">
                                <input type="text" id="left-entry-search" placeholder="🔍 搜索左侧条目...">
                            </div>
                        </div>

                    </div>
                    <div class="single-entries-container" id="single-container" style="display: none;">
                        <div class="single-side">
                            <div class="side-header">
                                <h5 id="single-preset-title">预设管理</h5>
                                <div class="side-controls">
                                    <div class="control-row">
                                        <button id="single-select-all" class="selection-btn">
                                            <span class="btn-icon">✓</span> 全选
                                        </button>
                                        <button id="single-select-none" class="selection-btn">
                                            <span class="btn-icon">✗</span> 不选
                                        </button>
                                    </div>
                                    <div class="control-row">
                                        <button id="single-new-entry" class="selection-btn">
                                            <span class="btn-icon">+</span> 新建
                                        </button>
                                    </div>
                                    <div class="display-options">
                                        <select id="single-display-mode" class="display-mode-select">
                                            <option value="default">仅显示已启用</option>
                                            <option value="include_disabled">显示全部</option>
                                        </select>
                                    </div>
                                </div>
                                <span id="single-selection-count" class="selection-count"></span>
                            </div>
                            <div id="single-entries-list" class="entries-list"></div>
                            <div class="side-actions">
                                <button id="single-edit" disabled>✏️ 编辑</button>
                                <button id="single-delete" disabled>🗑️ 删除</button>
                            </div>
                        </div>
                    </div>
                    <div class="dual-entries-container" id="dual-container">
                        <div class="entries-side" id="left-side">
                            <div class="side-header">
                                <h5 id="left-preset-title">左侧预设</h5>
                                <div class="side-controls">
                                    <div class="control-row">
                                        <button id="left-select-all" class="selection-btn">
                                            <span class="btn-icon">✓</span> 全选
                                        </button>
                                        <button id="left-select-none" class="selection-btn">
                                            <span class="btn-icon">✗</span> 不选
                                        </button>
                                    </div>
                                    <div class="control-row">
                                        <button id="left-new-entry" class="selection-btn">
                                            <span class="btn-icon">+</span> 新建
                                        </button>
                                    </div>
                                    <div class="display-options">
                                        <select id="left-display-mode" class="display-mode-select">
                                            <option value="default">仅显示已启用</option>
                                            <option value="include_disabled">显示全部</option>
                                        </select>
                                    </div>
                                    <div class="control-row">
                                        <button id="left-show-new" class="selection-btn">
                                            <span class="btn-icon">🆕</span> 新增
                                        </button>
                                        <button id="left-smart-transfer" class="selection-btn" disabled>
                                            <span class="btn-icon">🎯</span> 智能转移
                                        </button>
                                    </div>
                                </div>
                                <span id="left-selection-count" class="selection-count"></span>
                            </div>
                            <div class="left-search-container" style="display: none;">
                                <input type="text" id="left-entry-search-inline" placeholder="🔍 搜索左侧条目...">
                            </div>
                            <div id="left-entries-list" class="entries-list"></div>
                            <div class="side-actions">
                                <button id="left-edit" disabled>✏️ 编辑</button>
                                <button id="left-delete" disabled>🗑️ 删除</button>
                                <button id="transfer-to-right" disabled>➡️ 转移</button>
                            </div>

                        </div>
                        <div class="entries-side" id="right-side">
                            <div class="side-header">
                                <h5 id="right-preset-title">右侧预设</h5>
                                <div class="side-controls">
                                    <div class="control-row">
                                        <button id="right-select-all" class="selection-btn">
                                            <span class="btn-icon">✓</span> 全选
                                        </button>
                                        <button id="right-select-none" class="selection-btn">
                                            <span class="btn-icon">✗</span> 不选
                                        </button>
                                    </div>
                                    <div class="control-row">
                                        <button id="right-new-entry" class="selection-btn">
                                            <span class="btn-icon">+</span> 新建
                                        </button>
                                        <button id="compare-entries" class="selection-btn" disabled>
                                            <span class="btn-icon">⚖</span> 比较
                                        </button>
                                    </div>
                                    <div class="display-options">
                                        <select id="right-display-mode" class="display-mode-select">
                                            <option value="default">仅显示已启用</option>
                                            <option value="include_disabled">显示全部</option>
                                        </select>
                                    </div>
                                    <div class="control-row">
                                        <button id="right-show-new" class="selection-btn">
                                            <span class="btn-icon">🆕</span> 新增
                                        </button>
                                        <button id="right-smart-transfer" class="selection-btn" disabled>
                                            <span class="btn-icon">🎯</span> 智能转移
                                        </button>
                                    </div>
                                </div>
                                <span id="right-selection-count" class="selection-count"></span>
                            </div>
                            <div class="right-search-container" style="display: none;">
                                <input type="text" id="right-entry-search-inline" placeholder="🔍 搜索右侧条目...">
                            </div>
                            <div id="right-entries-list" class="entries-list"></div>
                            <div class="side-actions">
                                <button id="right-edit" disabled>✏️ 编辑</button>
                                <button id="right-delete" disabled>🗑️ 删除</button>
                                <button id="transfer-to-left" disabled>⬅️ 转移</button>
                            </div>

                        </div>
                    </div>
                    <div class="modal-actions">
                        <button id="close-modal">❌ 关闭</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('body').append(modalHtml);
    applyStyles(isMobile, isSmallScreen, isPortrait);
    bindTransferEvents(apiInfo, $('#preset-transfer-modal'));
}

function applyStyles(isMobile, isSmallScreen, isPortrait) {
    const isDark = isDarkTheme();
    const bgColor = isDark ? '#1a1a1a' : '#ffffff';
    const textColor = isDark ? '#e0e0e0' : '#374151';
    const borderColor = isDark ? '#374151' : '#e5e7eb';
    const inputBg = isDark ? '#2d2d2d' : '#ffffff';
    const inputBorder = isDark ? '#4b5563' : '#d1d5db';
    const sectionBg = isDark ? '#262626' : '#f9fafb';

    const styles = `
        #preset-transfer-modal {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
            z-index: 10000; display: flex; align-items: ${isMobile ? 'flex-start' : 'center'};
            justify-content: center; padding: ${isMobile ? '10px' : '20px'};
            ${isMobile ? 'padding-top: 20px;' : ''}
            overflow-y: auto; -webkit-overflow-scrolling: touch; animation: pt-fadeIn 0.3s ease-out;
        }
        #preset-transfer-modal .transfer-modal-content {
            background: ${bgColor}; border-radius: ${isMobile ? '16px' : '20px'};
            padding: ${isSmallScreen ? '24px' : isMobile ? '28px' : '32px'};
            max-width: ${isSmallScreen ? '95vw' : isMobile ? '90vw' : '1000px'};
            width: ${isSmallScreen ? '95vw' : isMobile ? '90vw' : '90%'};
            min-height: ${isMobile ? 'auto' : '400px'}; max-height: ${isMobile ? '90vh' : '85vh'};
            overflow-y: auto; color: ${textColor}; box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            ${isMobile ? '-webkit-overflow-scrolling: touch;' : ''}
            animation: pt-slideUp 0.3s ease-out;
            transition: background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease;
        }
        #preset-transfer-modal .modal-header {
            text-align: center; margin-bottom: ${isMobile ? '24px' : '28px'};
            padding-bottom: ${isMobile ? '18px' : '22px'}; border-bottom: 1px solid ${borderColor}; position: relative;
        }
        #preset-transfer-modal .theme-toggle-btn {
            position: absolute; left: 0; top: 50%; transform: translateY(-50%);
            background: rgba(${isDark ? '255,255,255' : '0,0,0'}, 0.1); border: none;
            border-radius: 50%; width: ${isMobile ? '40px' : '36px'}; height: ${isMobile ? '40px' : '36px'};
            font-size: ${isMobile ? '18px' : '16px'}; cursor: pointer;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); display: flex; align-items: center; justify-content: center;
            backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        #preset-transfer-modal .theme-toggle-btn:hover {
            background: rgba(${isDark ? '255,255,255' : '0,0,0'}, 0.2);
            transform: translateY(-50%) scale(1.05);
        }
        #preset-transfer-modal .theme-toggle-btn:active {
            transform: translateY(-50%) scale(0.98);
        }
        #preset-transfer-modal .modal-header > div:first-of-type {
            display: flex; align-items: center; justify-content: center;
            gap: 12px; padding: ${isMobile ? '8px 0' : '12px 0'};
        }
        #preset-transfer-modal .modal-header span:first-child { font-size: ${isSmallScreen ? '28px' : isMobile ? '32px' : '36px'}; }
        #preset-transfer-modal .modal-header h2 {
            margin: 0; font-size: ${isSmallScreen ? '22px' : isMobile ? '24px' : '28px'};
            font-weight: 700; color: ${isDark ? '#f3f4f6' : '#111827'}; letter-spacing: -0.5px;
        }
        #preset-transfer-modal .version-info {
            margin-top: 8px; text-align: center;
            color: ${isDark ? '#9ca3af' : '#6b7280'}; opacity: 0.8; display: flex;
            align-items: center; justify-content: center; gap: 8px;
        }
        #preset-transfer-modal .version-info .author {
            font-weight: 500; color: ${isDark ? '#9ca3af' : '#6b7280'};
            font-size: ${isSmallScreen ? '10px' : isMobile ? '11px' : '13px'} !important;
        }
        #preset-transfer-modal .preset-selection {
            display: ${isMobile ? 'flex' : 'grid'};
            ${isMobile ? 'flex-direction: column;' : 'grid-template-columns: 1fr 1fr;'}
            gap: ${isMobile ? '18px' : '22px'}; margin-bottom: ${isMobile ? '24px' : '28px'};
        }
        #preset-transfer-modal .preset-field {
            padding: ${isMobile ? '20px' : '24px'}; background: ${sectionBg};
            border-radius: 12px; border: 1px solid ${borderColor}; transition: all 0.3s ease;
        }
        #preset-transfer-modal .preset-field label {
            display: flex; flex-direction: column; justify-content: flex-start;
            margin-bottom: 14px; font-weight: 600; font-size: ${isMobile ? '16px' : '15px'};
            color: ${textColor}; min-height: 50px;
        }
        #preset-transfer-modal .preset-field label span:first-child { display: flex; align-items: center; gap: 10px; }
        #preset-transfer-modal .preset-field label span:first-child span {
            display: inline-flex; align-items: center; justify-content: center;
            width: 24px; height: 24px; background: ${inputBg}; border: 1px solid ${borderColor};
            border-radius: 6px; color: ${textColor}; font-size: 12px;
        }
        #preset-transfer-modal .preset-field label span:last-child {
            color: ${isDark ? '#9ca3af' : '#6b7280'}; font-weight: 400; font-size: ${isMobile ? '13px' : '12px'}; margin-top: 4px;
        }
        #preset-transfer-modal select {
            width: 100%; padding: ${isMobile ? '14px 16px' : '12px 14px'};
            background: ${inputBg}; color: ${textColor}; border: 1px solid ${inputBorder};
            border-radius: 8px; font-size: ${isMobile ? '15px' : '14px'}; font-weight: 500;
            appearance: none; background-image: url('data:image/svg+xml;charset=US-ASCII,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 5"><path fill="${isDark ? '%23e0e0e0' : '%236b7280'}" d="M2 0L0 2h4zm0 5L0 3h4z"/></svg>');
            background-repeat: no-repeat; background-position: right 16px center;
            background-size: 12px; padding-right: 45px; box-sizing: border-box;
            transition: all 0.3s ease; cursor: pointer;
        }
        #preset-transfer-modal select:focus {
            border-color: ${isDark ? '#60a5fa' : '#6b7280'} !important;
            box-shadow: 0 0 0 3px rgba(${isDark ? '96, 165, 250' : '107, 114, 128'}, 0.1) !important;
            outline: none !important;
        }
        #preset-transfer-modal .action-section {
            display: flex; flex-wrap: wrap; align-items: center;
            gap: ${isMobile ? '20px' : '20px'}; margin-bottom: ${isMobile ? '28px' : '25px'};
            ${isMobile ? 'justify-content: center; flex-direction: column;' : 'justify-content: flex-start;'}
        }
        #preset-transfer-modal #load-entries {
            padding: ${isMobile ? '18px 32px' : '14px 26px'}; background: ${isDark ? '#4b5563' : '#374151'};
            border: none; color: #ffffff; border-radius: 10px; cursor: pointer;
            font-size: ${isMobile ? '17px' : '15px'}; font-weight: 600;
            ${isMobile ? 'width: 100%; max-width: 300px;' : 'min-width: 150px;'}
            transition: all 0.3s ease; text-transform: uppercase; letter-spacing: 0.5px;
            ${isMobile ? 'margin-bottom: 10px;' : ''}
        }
        #preset-transfer-modal #load-entries:hover {
            background: ${isDark ? '#6b7280' : '#4b5563'};
            transform: translateY(-1px);
        }
        #preset-transfer-modal .auto-switch-label {
            display: flex; align-items: center; gap: ${isMobile ? '16px' : '12px'}; color: ${textColor};
            font-size: ${isMobile ? '16px' : '14px'}; font-weight: 500;
            cursor: pointer; user-select: none; ${isMobile ? `justify-content: flex-start; padding: 12px 16px; background: ${sectionBg}; border-radius: 12px; width: 100%; max-width: 300px; border: 1px solid ${borderColor};` : ''}
        }
        #preset-transfer-modal .auto-switch-label input {
            ${isMobile ? 'transform: scale(1.4);' : 'transform: scale(1.2);'}
            accent-color: ${isDark ? '#60a5fa' : '#374151'}; cursor: pointer;
        }
        #preset-transfer-modal #entries-container { width: 100%; }
        #preset-transfer-modal .entries-header {
            margin-bottom: ${isMobile ? '20px' : '25px'}; padding: ${isMobile ? '18px' : '22px'};
            background: ${sectionBg}; border-radius: 12px; border: 1px solid ${borderColor};
        }
        #preset-transfer-modal .entries-header h4 {
            color: ${textColor}; margin: 0 0 16px 0; font-size: ${isMobile ? '18px' : '17px'};
            font-weight: 700; letter-spacing: -0.3px;
        }
        #preset-transfer-modal .entries-header p {
            margin: 0 0 14px 0; font-size: ${isMobile ? '14px' : '13px'};
            color: ${isDark ? '#9ca3af' : '#6b7280'}; line-height: 1.5;
        }
        #preset-transfer-modal .search-section { margin-bottom: 16px; }
        #preset-transfer-modal .left-search-section {
            margin-bottom: 16px;
        }
        #preset-transfer-modal .left-search-container,
        #preset-transfer-modal .right-search-container {
            margin-bottom: 12px;
        }
        #preset-transfer-modal #left-entry-search,
        #preset-transfer-modal #left-entry-search-inline,
        #preset-transfer-modal #right-entry-search-inline {
            width: 100%; padding: ${isMobile ? '14px 18px' : '12px 16px'};
            background: ${inputBg}; color: ${textColor}; border: 1px solid ${inputBorder};
            border-radius: 8px; font-size: ${isMobile ? '15px' : '14px'}; font-weight: 400;
            transition: all 0.3s ease; box-sizing: border-box;
        }
        #preset-transfer-modal #left-entry-search:focus,
        #preset-transfer-modal #left-entry-search-inline:focus,
        #preset-transfer-modal #right-entry-search-inline:focus {
            border-color: ${isDark ? '#60a5fa' : '#6b7280'} !important;
            box-shadow: 0 0 0 3px rgba(${isDark ? '96, 165, 250' : '107, 114, 128'}, 0.1) !important;
            outline: none !important;
        }
        #preset-transfer-modal .display-option-label {
            display: flex; align-items: center; gap: 6px; color: ${textColor};
            font-size: ${isMobile ? '12px' : '11px'}; font-weight: 500;
            cursor: pointer; user-select: none; margin-left: ${isMobile ? '0px' : '6px'};
        }
        #preset-transfer-modal .display-option-label input {
            ${isMobile ? 'transform: scale(1.1);' : 'transform: scale(1.0);'}
            accent-color: ${isDark ? '#60a5fa' : '#374151'}; cursor: pointer;
        }
        #preset-transfer-modal #entry-search {
            width: 100%; padding: ${isMobile ? '14px 18px' : '12px 16px'};
            background: ${inputBg}; color: ${textColor}; border: 1px solid ${inputBorder};
            border-radius: 8px; font-size: ${isMobile ? '15px' : '14px'}; font-weight: 400;
            transition: all 0.3s ease; box-sizing: border-box;
        }
        #preset-transfer-modal #entry-search:focus {
            border-color: ${isDark ? '#60a5fa' : '#6b7280'} !important;
            box-shadow: 0 0 0 3px rgba(${isDark ? '96, 165, 250' : '107, 114, 128'}, 0.1) !important;
            outline: none !important;
        }
        #preset-transfer-modal .selection-controls {
            display: ${isMobile ? 'grid' : 'flex'};
            ${isMobile ? 'grid-template-columns: 1fr 1fr; grid-gap: 10px;' : 'flex-wrap: wrap; gap: 10px;'}
            align-items: center; margin-bottom: 8px;
        }
        #preset-transfer-modal .selection-btn {
            padding: ${isMobile ? '12px 18px' : '10px 16px'}; border: none; color: #ffffff;
            border-radius: 6px; cursor: pointer; font-size: ${isMobile ? '14px' : '13px'};
            font-weight: 600; transition: all 0.3s ease; display: flex; align-items: center;
            justify-content: center; gap: 6px;
        }
        #preset-transfer-modal .selection-btn .btn-icon {
            font-size: ${isMobile ? '16px' : '14px'}; font-weight: bold;
            display: inline-flex; align-items: center; justify-content: center;
            width: ${isMobile ? '20px' : '18px'}; height: ${isMobile ? '20px' : '18px'};
            background: rgba(255,255,255,0.2); border-radius: 50%;
            line-height: 1;
        }
        #preset-transfer-modal #select-all { background: #6b7280; ${isMobile && isPortrait ? '' : 'min-width: 90px;'} }
        #preset-transfer-modal #select-none { background: #9ca3af; ${isMobile && isPortrait ? '' : 'min-width: 90px;'} }
        #preset-transfer-modal #select-new { background: #4b5563; ${isMobile && isPortrait ? 'grid-column: 1 / -1;' : 'min-width: 100px;'} }
        #preset-transfer-modal #selection-count {
            ${isMobile && isPortrait ? 'grid-column: 1 / -1; text-align: center; margin-top: 10px;' : 'margin-left: auto;'}
            color: #374151; font-size: ${isMobile ? '14px' : '13px'}; font-weight: 600;
            padding: 8px 14px; background: #f3f4f6; border-radius: 6px;
        }
        #preset-transfer-modal .dual-entries-container {
            display: ${isMobile ? 'flex' : 'grid'};
            ${isMobile ? 'flex-direction: column;' : 'grid-template-columns: 1fr 1fr;'}
            gap: ${isMobile ? '8px' : '20px'}; margin-bottom: ${isMobile ? '20px' : '25px'};
        }
        #preset-transfer-modal .single-entries-container {
            margin-bottom: ${isMobile ? '20px' : '25px'};
            position: relative;
        }
        #preset-transfer-modal .single-side {
            border: 1px solid ${borderColor}; border-radius: 12px; background: ${sectionBg};
            padding: ${isMobile ? '16px' : '18px'};
        }
        /* 单预设模式下隐藏双预设容器 */
        #preset-transfer-modal .single-entries-container:not([style*="display: none"]) ~ .dual-entries-container {
            display: none !important;
        }
        #preset-transfer-modal .entries-side {
            border: 1px solid ${borderColor}; border-radius: 12px; background: ${sectionBg};
            padding: ${isMobile ? '16px' : '18px'};
        }
        #preset-transfer-modal .side-header {
            margin-bottom: ${isMobile ? '14px' : '16px'}; padding-bottom: ${isMobile ? '12px' : '14px'};
            border-bottom: 1px solid ${borderColor};
        }
        #preset-transfer-modal .side-header h5 {
            margin: 0 0 ${isMobile ? '10px' : '12px'} 0; font-size: ${isMobile ? '16px' : '15px'};
            font-weight: 700; color: ${textColor};
        }
        #preset-transfer-modal .side-controls {
            display: flex; flex-direction: column; gap: ${isMobile ? '6px' : '10px'};
            margin-bottom: ${isMobile ? '12px' : '10px'};
        }
        #preset-transfer-modal .control-row {
            display: ${isMobile ? 'grid' : 'flex'};
            ${isMobile ? 'grid-template-columns: 1fr 1fr; grid-gap: 6px;' : 'gap: 10px; flex-wrap: wrap;'}
        }
        #preset-transfer-modal .selection-count {
            font-size: ${isMobile ? '13px' : '12px'}; color: ${isDark ? '#9ca3af' : '#6b7280'}; font-weight: 500;
        }
        #preset-transfer-modal .entries-list {
            min-height: ${isSmallScreen ? '240px' : isMobile ? '320px' : '300px'};
            max-height: ${isSmallScreen ? '380px' : isMobile ? '480px' : '450px'};
            overflow-y: auto; border: 1px solid ${borderColor}; border-radius: 10px;
            background: ${inputBg}; padding: ${isMobile ? '12px' : '12px'};
            -webkit-overflow-scrolling: touch; scrollbar-width: thin;
            scrollbar-color: ${isDark ? '#4b5563 transparent' : '#d1d5db transparent'};
        }
        #preset-transfer-modal .side-actions {
            margin-top: ${isMobile ? '16px' : '14px'}; display: flex; gap: ${isMobile ? '12px' : '10px'};
            flex-wrap: wrap; justify-content: center;
        }
        #preset-transfer-modal .side-actions button {
            padding: ${isMobile ? '8px 12px' : '6px 10px'}; border: none; color: #ffffff;
            border-radius: 8px; cursor: pointer; font-size: ${isMobile ? '11px' : '11px'};
            font-weight: 600; transition: all 0.3s ease;
            ${isMobile ? 'min-width: 60px;' : ''}
        }
        #preset-transfer-modal .side-actions button[id$="-edit"] { background: #059669; }
        #preset-transfer-modal .side-actions button[id$="-delete"] { background: #dc2626; }
        #preset-transfer-modal .side-actions button[id^="transfer-"] { background: #2563eb; }
        #preset-transfer-modal .side-controls .selection-btn {
            background: ${isDark ? '#4b5563' : '#6b7280'}; padding: ${isMobile ? '6px 8px' : '4px 8px'};
            font-size: ${isMobile ? '10px' : '10px'}; border-radius: 6px;
            ${isMobile ? 'min-width: 50px;' : ''} border: none; color: #ffffff;
            transition: all 0.3s ease; cursor: pointer;
        }
        #preset-transfer-modal .side-controls .selection-btn:hover {
            background: ${isDark ? '#6b7280' : '#4b5563'}; transform: translateY(-1px);
        }
        #preset-transfer-modal .entries-side.transfer-target {
            border-color: #3b82f6; background: #eff6ff;
        }
        #preset-transfer-modal .entries-side.transfer-source {
            border-color: #f59e0b; background: #fffbeb;
        }
        #preset-transfer-modal .entries-side.new-entry-target {
            border-color: #10b981; background: #ecfdf5;
        }

        /* 搜索跳转按钮样式 */
        #preset-transfer-modal .jump-btn {
            position: absolute; right: ${isMobile ? '12px' : '8px'}; top: 50%;
            transform: translateY(-50%); background: ${isDark ? '#3b82f6' : '#2563eb'};
            border: none; border-radius: 50%; width: ${isMobile ? '32px' : '28px'};
            height: ${isMobile ? '32px' : '28px'}; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            transition: all 0.3s ease; z-index: 10;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        #preset-transfer-modal .jump-btn:hover {
            background: ${isDark ? '#2563eb' : '#1d4ed8'};
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
        }
        #preset-transfer-modal .jump-btn .jump-icon {
            color: #ffffff; font-size: ${isMobile ? '16px' : '14px'}; font-weight: bold;
            line-height: 1; transform: rotate(-45deg);
        }

        /* 跳转高亮效果 */
        #preset-transfer-modal .entry-item.jump-highlight {
            background: ${isDark ? 'rgba(59, 130, 246, 0.2)' : 'rgba(37, 99, 235, 0.1)'} !important;
            border-color: ${isDark ? '#3b82f6' : '#2563eb'} !important;
            box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3) !important;
            animation: pt-jumpPulse 2s ease-in-out;
        }

        @keyframes pt-jumpPulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.02); }
        }

        #preset-transfer-modal #insert-position-section {
            margin: ${isMobile ? '20px 0' : '25px 0'}; padding: ${isMobile ? '20px' : '24px'};
            background: #f9fafb; border-radius: 12px; border: 1px solid #e5e7eb;
        }
        #preset-transfer-modal #insert-position-section label {
            display: flex; align-items: center; gap: 10px; margin-bottom: 12px;
            font-weight: 600; font-size: ${isMobile ? '16px' : '15px'}; color: #374151;
        }
        #preset-transfer-modal #insert-position-section label span {
            display: inline-flex; align-items: center; justify-content: center;
            width: 26px; height: 26px; background: #ffffff; border: 1px solid #e5e7eb;
            border-radius: 6px; color: #374151; font-size: 14px;
        }
        #preset-transfer-modal #insert-position-section p {
            margin: 0 0 16px 0; font-size: ${isMobile ? '14px' : '13px'};
            color: #6b7280; line-height: 1.5;
        }
        #preset-transfer-modal .modal-actions {
            display: flex; justify-content: center; flex-wrap: wrap;
            gap: ${isMobile ? '10px' : '14px'}; margin-top: ${isMobile ? '20px' : '25px'};
            padding: ${isMobile ? '20px 0' : '24px 0'}; border-top: 1px solid ${borderColor};
        }
        #preset-transfer-modal .modal-actions button {
            padding: ${isMobile ? '14px 20px' : '12px 20px'}; border: none; color: #ffffff;
            border-radius: 8px; cursor: pointer; font-size: ${isMobile ? '14px' : '14px'};
            font-weight: 600; transition: all 0.3s ease; letter-spacing: 0.3px;
        }
        #preset-transfer-modal .modal-actions button:hover {
            transform: translateY(-1px); box-shadow: 0 4px 8px rgba(0,0,0,0.1);
        }
        #preset-transfer-modal .modal-actions button:active {
            transform: translateY(0); box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        #preset-transfer-modal #execute-transfer { background: ${isDark ? '#4b5563' : '#374151'}; ${isMobile ? '' : 'min-width: 130px;'} }
        #preset-transfer-modal #execute-delete { background: ${isDark ? '#6b7280' : '#6b7280'}; ${isMobile ? '' : 'min-width: 130px;'} }
        #preset-transfer-modal #edit-entry { background: #059669; ${isMobile ? '' : 'min-width: 130px;'} }
        #preset-transfer-modal #close-modal { background: ${isDark ? '#6b7280' : '#9ca3af'}; ${isMobile ? '' : 'min-width: 90px;'} }
    `;
    if (!$('#preset-transfer-styles').length) {
        $('head').append(`<style id="preset-transfer-styles">${styles}</style>`);
    }

    // 设置CSS变量以支持主题切换
    const modal = $('#preset-transfer-modal');
    if (modal.length) {
        const modalEl = modal[0];
        if (isDark) {
            modalEl.style.setProperty('--pt-scrollbar-track-color', '#2d2d2d');
            modalEl.style.setProperty('--pt-scrollbar-thumb-color', '#4b5563');
            modalEl.style.setProperty('--pt-scrollbar-thumb-hover-color', '#6b7280');
            modalEl.style.setProperty('--pt-entry-hover-border', '#60a5fa');
            modalEl.style.setProperty('--pt-entry-hover-shadow', 'rgba(0,0,0,0.3)');
            modalEl.style.setProperty('--pt-entry-active-shadow', 'rgba(0,0,0,0.2)');
            modalEl.style.setProperty('--pt-input-focus-border', '#60a5fa');
            modalEl.style.setProperty('--pt-input-focus-shadow', 'rgba(96, 165, 250, 0.1)');
        } else {
            modalEl.style.setProperty('--pt-scrollbar-track-color', '#f3f4f6');
            modalEl.style.setProperty('--pt-scrollbar-thumb-color', '#d1d5db');
            modalEl.style.setProperty('--pt-scrollbar-thumb-hover-color', '#9ca3af');
            modalEl.style.setProperty('--pt-entry-hover-border', '#9ca3af');
            modalEl.style.setProperty('--pt-entry-hover-shadow', 'rgba(0,0,0,0.1)');
            modalEl.style.setProperty('--pt-entry-active-shadow', 'rgba(0,0,0,0.05)');
            modalEl.style.setProperty('--pt-input-focus-border', '#6b7280');
            modalEl.style.setProperty('--pt-input-focus-shadow', 'rgba(107, 114, 128, 0.1)');
        }
    }
}

function bindTransferEvents(apiInfo, modal) {
    const $ = getJQuery();
    const leftSelect = $('#left-preset');
    const rightSelect = $('#right-preset');
    const loadBtn = $('#load-entries');

    // 加载保存的设置
    applyStoredSettings();

    // 初始化主题按钮
    updateThemeButton();

    // 主题切换按钮事件
    $('#theme-toggle-btn').on('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        toggleTransferToolTheme();
        // 重新应用样式以反映主题变化，但保持当前状态
        setTimeout(() => {
            updateModalTheme();
        }, 150);
    });

    leftSelect.add(rightSelect).on('change', function() {
        const hasLeft = leftSelect.val();
        const hasRight = rightSelect.val();
        // 至少选择一个预设就可以加载条目
        loadBtn.prop('disabled', !hasLeft && !hasRight);
        $('#entries-container').hide();
        saveCurrentSettings(); // 保存设置
    });

    loadBtn.on('click', () => loadAndDisplayEntries(apiInfo));
    $('#entry-search').on('input', function() { filterDualEntries($(this).val()); });
    $('#left-entry-search').on('input', function() { filterSideEntries('left', $(this).val()); });
    $('#left-entry-search-inline').on('input', function() { filterSideEntries('left', $(this).val()); });
    $('#right-entry-search-inline').on('input', function() { filterSideEntries('right', $(this).val()); });
    $('#left-display-mode, #right-display-mode, #single-display-mode').on('change', () => {
        loadAndDisplayEntries(apiInfo);
        saveCurrentSettings();
    });

    // 绑定设置变更事件
    $('#auto-close-modal, #auto-enable-entry').on('change', saveCurrentSettings);

    // 左侧控制
    $('#left-select-all').on('click', () => { $('#left-entries-list .entry-checkbox').prop('checked', true); updateDualSelectionCount(); });
    $('#left-select-none').on('click', () => { $('#left-entries-list .entry-checkbox').prop('checked', false); updateDualSelectionCount(); });
    $('#left-new-entry').on('click', () => startNewEntryMode(apiInfo, 'left'));
    $('#left-show-new').on('click', () => toggleNewEntries(apiInfo, 'left'));
    $('#left-smart-transfer').on('click', () => startSmartTransferMode(apiInfo, 'left', 'right'));
    $('#left-edit').on('click', () => editSelectedEntry(apiInfo, 'left'));
    $('#left-delete').on('click', () => deleteSelectedEntries(apiInfo, 'left'));
    $('#transfer-to-right').on('click', () => startTransferMode(apiInfo, 'left', 'right'));

    // 右侧控制
    $('#right-select-all').on('click', () => { $('#right-entries-list .entry-checkbox').prop('checked', true); updateDualSelectionCount(); });
    $('#right-select-none').on('click', () => { $('#right-entries-list .entry-checkbox').prop('checked', false); updateDualSelectionCount(); });
    $('#right-new-entry').on('click', () => startNewEntryMode(apiInfo, 'right'));
    $('#right-show-new').on('click', () => toggleNewEntries(apiInfo, 'right'));
    $('#right-smart-transfer').on('click', () => startSmartTransferMode(apiInfo, 'right', 'left'));
    $('#right-edit').on('click', () => editSelectedEntry(apiInfo, 'right'));
    $('#right-delete').on('click', () => deleteSelectedEntries(apiInfo, 'right'));
    $('#transfer-to-left').on('click', () => startTransferMode(apiInfo, 'right', 'left'));
    $('#compare-entries').on('click', () => showCompareModal(apiInfo));

    // 单预设控制
    $('#single-select-all').on('click', () => { $('#single-entries-list .entry-checkbox').prop('checked', true); updateSingleSelectionCount(); });
    $('#single-select-none').on('click', () => { $('#single-entries-list .entry-checkbox').prop('checked', false); updateSingleSelectionCount(); });
    $('#single-new-entry').on('click', () => startNewEntryMode(apiInfo, 'single'));
    $('#single-edit').on('click', () => editSelectedEntry(apiInfo, 'single'));
    $('#single-delete').on('click', () => deleteSelectedEntries(apiInfo, 'single'));

    $('#close-modal').on('click', () => modal.remove());
    modal.on('click', e => { if (e.target === modal[0]) modal.remove(); });
    $(document).on('keydown.preset-transfer', e => { if (e.key === 'Escape') { modal.remove(); $(document).off('keydown.preset-transfer'); } });

    if (getDeviceInfo().isMobile) {
        const originalOverflow = $('body').css('overflow');
        $('body').css('overflow', 'hidden');
        modal.on('remove', () => $('body').css('overflow', originalOverflow));
    }
    modal.css('display', 'flex');
}

function applyStoredSettings() {
    const $ = getJQuery();
    const settings = loadTransferSettings();

    $('#auto-close-modal').prop('checked', settings.autoCloseModal);
    $('#auto-enable-entry').prop('checked', settings.autoEnableEntry);
    $('#left-display-mode').val(settings.leftDisplayMode);
    $('#right-display-mode').val(settings.rightDisplayMode);
    $('#single-display-mode').val(settings.singleDisplayMode);
}

function saveCurrentSettings() {
    const $ = getJQuery();
    const settings = {
        autoCloseModal: $('#auto-close-modal').prop('checked'),
        autoEnableEntry: $('#auto-enable-entry').prop('checked'),
        leftDisplayMode: $('#left-display-mode').val(),
        rightDisplayMode: $('#right-display-mode').val(),
        singleDisplayMode: $('#single-display-mode').val(),
    };
    saveTransferSettings(settings);
}

function loadAndDisplayEntries(apiInfo) {
    const $ = getJQuery();
    const leftPreset = $('#left-preset').val();
    const rightPreset = $('#right-preset').val();

    // 检查是否至少选择了一个预设
    if (!leftPreset && !rightPreset) {
        alert('请至少选择一个预设');
        return;
    }

    // 判断是单预设还是双预设模式
    const isSingleMode = (leftPreset && !rightPreset) || (!leftPreset && rightPreset);

    if (isSingleMode) {
        loadSinglePresetMode(apiInfo, leftPreset || rightPreset);
    } else {
        loadDualPresetMode(apiInfo, leftPreset, rightPreset);
    }
}

function loadSinglePresetMode(apiInfo, presetName) {
    const $ = getJQuery();
    const displayMode = $('#single-display-mode').val();

    try {
        const presetData = getPresetDataFromManager(apiInfo, presetName);
        let entries = getOrderedPromptEntries(presetData, displayMode);
        entries = ensureAllEntriesHaveNewFields(entries);

        window.singleEntries = entries;
        window.singlePresetData = presetData;
        window.singlePresetName = presetName;

        displaySingleEntries(entries);
        $('#single-preset-title').text(`预设管理: ${presetName}`);

        // 隐藏双预设界面，显示单预设界面
        $('#dual-container').hide();
        $('#single-container').show();
        $('#entries-container').show();

        // 显示单一搜索栏，隐藏内联搜索栏
        $('#entry-search').show();
        $('.left-search-section').hide();
        $('.left-search-container').hide();
        $('.right-search-container').hide();

        updateSingleSelectionCount();

        // 重置模式
        window.transferMode = null;
        window.newEntryMode = null;

    } catch (error) {
        console.error('加载条目失败:', error);
        alert('加载条目失败: ' + error.message);
    }
}

function loadDualPresetMode(apiInfo, leftPreset, rightPreset) {
    const $ = getJQuery();
    const leftDisplayMode = $('#left-display-mode').val();
    const rightDisplayMode = $('#right-display-mode').val();

    try {
        // 获取预设数据
        const leftData = leftPreset ? getPresetDataFromManager(apiInfo, leftPreset) : null;
        const rightData = rightPreset ? getPresetDataFromManager(apiInfo, rightPreset) : null;

        // 加载左侧条目
        if (leftPreset) {
            let leftEntries = getOrderedPromptEntries(leftData, leftDisplayMode);
            leftEntries = ensureAllEntriesHaveNewFields(leftEntries);
            window.leftEntries = leftEntries;
            window.leftPresetData = leftData;
            displaySideEntries(leftEntries, 'left');
            $('#left-preset-title').text(`左侧预设: ${leftPreset}`);
        } else {
            window.leftEntries = [];
            window.leftPresetData = null;
            displaySideEntries([], 'left');
            $('#left-preset-title').text('左侧预设: 未选择');
        }

        // 加载右侧条目
        if (rightPreset) {
            let rightEntries = getOrderedPromptEntries(rightData, rightDisplayMode);
            rightEntries = ensureAllEntriesHaveNewFields(rightEntries);
            window.rightEntries = rightEntries;
            window.rightPresetData = rightData;
            displaySideEntries(rightEntries, 'right');
            $('#right-preset-title').text(`右侧预设: ${rightPreset}`);
        } else {
            window.rightEntries = [];
            window.rightPresetData = null;
            displaySideEntries([], 'right');
            $('#right-preset-title').text('右侧预设: 未选择');
        }

        // 显示双预设界面，隐藏单预设界面
        $('#single-container').hide();
        $('#dual-container').show();
        $('#entries-container').show();

        // 隐藏单一搜索栏，显示内联搜索栏
        $('#entry-search').hide();
        $('.left-search-section').hide();
        $('.left-search-container').show();
        $('.right-search-container').show();

        updateDualSelectionCount();
        updateCompareButton();

        // 重置转移模式
        window.transferMode = null;
        window.newEntryMode = null;

    } catch (error) {
        console.error('加载条目失败:', error);
        alert('加载条目失败: ' + error.message);
    }
}

function displaySideEntries(entries, side) {
    const $ = getJQuery();
    const entriesList = $(`#${side}-entries-list`);
    if (!entriesList.length) { console.error(`${side}侧条目列表容器未找到`); return; }

    const { isMobile, isSmallScreen } = getDeviceInfo();
    const isDark = isDarkTheme();

    // 深色主题颜色变量
    const entryBg = isDark ? '#2d2d2d' : '#ffffff';
    const entryBorder = isDark ? '#4b5563' : '#e5e7eb';
    const entryTextColor = isDark ? '#e0e0e0' : '#111827';
    const entryDetailsColor = isDark ? '#9ca3af' : '#6b7280';
    const emptyTextColor = isDark ? '#9ca3af' : '#6b7280';
    const checkboxAccent = isDark ? '#60a5fa' : '#374151';

    // 添加默认插入位置
    let entriesHtml = `
        <div class="entry-item position-item" data-position="top" data-side="${side}" style="border-color: #10b981; background: #ecfdf5; transition: all 0.3s ease; cursor: pointer; position: relative; display: flex; align-items: center; padding: ${isSmallScreen ? '12px 10px' : isMobile ? '14px 12px' : '12px 14px'}; margin-bottom: ${isMobile ? '8px' : '6px'}; border: 2px dashed #10b981; border-radius: 8px; ${isMobile ? 'min-height: 50px;' : 'min-height: 40px;'}">
            <div style="flex: 1; text-align: center;">
                <div class="entry-name" style="font-weight: 600; color: #059669; font-size: ${isSmallScreen ? '13px' : isMobile ? '14px' : '13px'}; line-height: 1.3;">📍 插入到顶部</div>
            </div>
        </div>
    `;

    if (entries.length === 0) {
        entriesHtml += `<div style="color: ${emptyTextColor}; text-align: center; padding: ${isMobile ? '30px 15px' : '40px 20px'}; font-size: ${isMobile ? '14px' : '13px'}; font-weight: 500;"><div style="font-size: 48px; margin-bottom: 15px; opacity: 0.3;">📭</div><div>没有条目</div></div>`;
    } else {
        entriesHtml += entries.map((entry, index) => {
            return `
                <div class="entry-item" data-index="${index}" data-side="${side}" data-identifier="${entry.identifier}" style="border-color: ${entryBorder}; background: ${entryBg}; transition: all 0.3s ease; cursor: pointer; position: relative; display: flex; align-items: center; padding: ${isSmallScreen ? '8px 6px' : isMobile ? '8px 8px' : '12px 14px'}; margin-bottom: ${isMobile ? '6px' : '6px'}; border: 1px solid ${entryBorder}; border-radius: 8px; ${isMobile ? 'min-height: 32px;' : 'min-height: 40px;'}">
                    <input type="checkbox" class="entry-checkbox" style="margin-right: ${isMobile ? '8px' : '10px'}; width: ${isMobile ? '14px' : '14px'}; height: ${isMobile ? '14px' : '14px'}; accent-color: ${checkboxAccent}; cursor: pointer; position: relative; z-index: 10;">
                    <div style="flex: 1; ${isMobile ? 'min-width: 0;' : ''}">
                        <div class="entry-name" style="font-weight: 600; color: ${entryTextColor}; font-size: ${isSmallScreen ? '11px' : isMobile ? '11px' : '13px'}; word-break: break-word; line-height: 1.2;">${entry.name}</div>
                        ${isMobile ? '' : `<div class="entry-details" style="font-size: 11px; color: ${entryDetailsColor}; line-height: 1.4; margin-top: 2px;">
                            <span>👤 ${entry.role || 'system'}</span>
                            <span style="margin-left: 8px;">📍 ${entry.injection_position || 'relative'}</span>
                            <span style="margin-left: 8px;">🔢 ${entry.injection_depth ?? 4}</span>
                            <span style="margin-left: 8px;">#️⃣ ${entry.injection_order ?? 100}</span>
                            <span style="margin-left: 8px;">⚡️ ${entry.injection_trigger?.join(', ') || '无'}</span>
                        </div>`}
                    </div>
                </div>`;
        }).join('');
    }

    // 添加底部插入位置
    entriesHtml += `
        <div class="entry-item position-item" data-position="bottom" data-side="${side}" style="border-color: #10b981; background: #ecfdf5; transition: all 0.3s ease; cursor: pointer; position: relative; display: flex; align-items: center; padding: ${isSmallScreen ? '12px 10px' : isMobile ? '14px 12px' : '12px 14px'}; margin-bottom: ${isMobile ? '8px' : '6px'}; border: 2px dashed #10b981; border-radius: 8px; ${isMobile ? 'min-height: 50px;' : 'min-height: 40px;'}">
            <div style="flex: 1; text-align: center;">
                <div class="entry-name" style="font-weight: 600; color: #059669; font-size: ${isSmallScreen ? '13px' : isMobile ? '14px' : '13px'}; line-height: 1.3;">📍 插入到底部</div>
            </div>
        </div>
    `;

    entriesList.html(entriesHtml);

    setTimeout(() => {
        const parentJQuery = getParentWindow().$;
        const entriesContainer = parentJQuery(`#${side}-entries-list`);
        entriesContainer.off('change', '.entry-checkbox').on('change', '.entry-checkbox', () => { updateDualSelectionCount(); });
        entriesContainer.off('click', '.entry-item').on('click', '.entry-item', function(e) {
            if (!parentJQuery(e.target).is('.entry-checkbox')) {
                e.preventDefault();

                // 检查是否是位置项
                if (parentJQuery(this).hasClass('position-item')) {
                    const position = parentJQuery(this).data('position');

                    if (window.transferMode && window.transferMode.toSide === side) {
                        executeTransferToPosition(window.transferMode.apiInfo, window.transferMode.fromSide, side, position);
                        return;
                    }

                    if (window.newEntryMode && window.newEntryMode.side === side) {
                        executeNewEntryAtPosition(window.newEntryMode.apiInfo, side, position);
                        return;
                    }
                    return;
                }

                // 检查是否在转移模式
                if (window.transferMode && window.transferMode.toSide === side) {
                    const index = parseInt(parentJQuery(this).data('index'));
                    executeTransferToPosition(window.transferMode.apiInfo, window.transferMode.fromSide, side, index);
                    return;
                }

                // 检查是否在新建模式
                if (window.newEntryMode && window.newEntryMode.side === side) {
                    const index = parseInt(parentJQuery(this).data('index'));
                    executeNewEntryAtPosition(window.newEntryMode.apiInfo, side, index);
                    return;
                }

                // 正常的选择模式
                const checkbox = parentJQuery(this).find('.entry-checkbox');
                checkbox.prop('checked', !checkbox.prop('checked')).trigger('change');
            }
        });
    }, 50);
}

function displaySingleEntries(entries) {
    const $ = getJQuery();
    const entriesList = $('#single-entries-list');
    if (!entriesList.length) { console.error('单预设条目列表容器未找到'); return; }

    const { isMobile, isSmallScreen } = getDeviceInfo();
    const isDark = isDarkTheme();

    // 深色主题颜色变量
    const entryBg = isDark ? '#2d2d2d' : '#ffffff';
    const entryBorder = isDark ? '#4b5563' : '#e5e7eb';
    const entryTextColor = isDark ? '#e0e0e0' : '#111827';
    const entryDetailsColor = isDark ? '#9ca3af' : '#6b7280';
    const emptyTextColor = isDark ? '#9ca3af' : '#6b7280';
    const checkboxAccent = isDark ? '#60a5fa' : '#374151';

    // 添加默认插入位置
    let entriesHtml = `
        <div class="entry-item position-item" data-position="top" style="border-color: #10b981; background: #ecfdf5; transition: all 0.3s ease; cursor: pointer; position: relative; display: flex; align-items: center; padding: ${isSmallScreen ? '12px 10px' : isMobile ? '14px 12px' : '12px 14px'}; margin-bottom: ${isMobile ? '8px' : '6px'}; border: 2px dashed #10b981; border-radius: 8px; ${isMobile ? 'min-height: 50px;' : 'min-height: 40px;'}">
            <div style="flex: 1; text-align: center;">
                <div class="entry-name" style="font-weight: 600; color: #059669; font-size: ${isSmallScreen ? '13px' : isMobile ? '14px' : '13px'}; line-height: 1.3;">📍 插入到顶部</div>
            </div>
        </div>
    `;

    if (entries.length === 0) {
        entriesHtml += `<div style="color: ${emptyTextColor}; text-align: center; padding: ${isMobile ? '30px 15px' : '40px 20px'}; font-size: ${isMobile ? '14px' : '13px'}; font-weight: 500;"><div style="font-size: 48px; margin-bottom: 15px; opacity: 0.3;">📭</div><div>没有条目</div></div>`;
    } else {
        entriesHtml += entries.map((entry, index) => {
            return `
                <div class="entry-item" data-index="${index}" data-side="single" data-identifier="${entry.identifier}" style="border-color: ${entryBorder}; background: ${entryBg}; transition: all 0.3s ease; cursor: pointer; position: relative; display: flex; align-items: center; padding: ${isSmallScreen ? '8px 6px' : isMobile ? '8px 8px' : '12px 14px'}; margin-bottom: ${isMobile ? '6px' : '6px'}; border: 1px solid ${entryBorder}; border-radius: 8px; ${isMobile ? 'min-height: 32px;' : 'min-height: 40px;'}">
                    <input type="checkbox" class="entry-checkbox" style="margin-right: ${isMobile ? '8px' : '10px'}; width: ${isMobile ? '14px' : '14px'}; height: ${isMobile ? '14px' : '14px'}; accent-color: ${checkboxAccent}; cursor: pointer; position: relative; z-index: 10;">
                    <div style="flex: 1; ${isMobile ? 'min-width: 0;' : ''}">
                        <div class="entry-name" style="font-weight: 600; color: ${entryTextColor}; font-size: ${isSmallScreen ? '11px' : isMobile ? '11px' : '13px'}; word-break: break-word; line-height: 1.2;">${entry.name}</div>
                        ${isMobile ? '' : `<div class="entry-details" style="font-size: 11px; color: ${entryDetailsColor}; line-height: 1.4; margin-top: 2px;">
                            <span>👤 ${entry.role || 'system'}</span>
                            <span style="margin-left: 8px;">📍 ${entry.injection_position || 'relative'}</span>
                            <span style="margin-left: 8px;">🔢 ${entry.injection_depth ?? 4}</span>
                            <span style="margin-left: 8px;">#️⃣ ${entry.injection_order ?? 100}</span>
                            <span style="margin-left: 8px;">⚡️ ${entry.injection_trigger?.join(', ') || '无'}</span>
                        </div>`}
                    </div>
                </div>`;
        }).join('');
    }

    // 添加底部插入位置
    entriesHtml += `
        <div class="entry-item position-item" data-position="bottom" style="border-color: #10b981; background: #ecfdf5; transition: all 0.3s ease; cursor: pointer; position: relative; display: flex; align-items: center; padding: ${isSmallScreen ? '12px 10px' : isMobile ? '14px 12px' : '12px 14px'}; margin-bottom: ${isMobile ? '8px' : '6px'}; border: 2px dashed #10b981; border-radius: 8px; ${isMobile ? 'min-height: 50px;' : 'min-height: 40px;'}">
            <div style="flex: 1; text-align: center;">
                <div class="entry-name" style="font-weight: 600; color: #059669; font-size: ${isSmallScreen ? '13px' : isMobile ? '14px' : '13px'}; line-height: 1.3;">📍 插入到底部</div>
            </div>
        </div>
    `;

    entriesList.html(entriesHtml);

    setTimeout(() => {
        const parentJQuery = getParentWindow().$;
        const entriesContainer = parentJQuery('#single-entries-list');
        entriesContainer.off('change', '.entry-checkbox').on('change', '.entry-checkbox', () => { updateSingleSelectionCount(); });
        entriesContainer.off('click', '.entry-item').on('click', '.entry-item', function(e) {
            if (!parentJQuery(e.target).is('.entry-checkbox')) {
                e.preventDefault();

                // 检查是否是位置项
                if (parentJQuery(this).hasClass('position-item')) {
                    if (window.newEntryMode && window.newEntryMode.side === 'single') {
                        const position = parentJQuery(this).data('position');
                        executeNewEntryAtPosition(window.newEntryMode.apiInfo, 'single', position);
                        return;
                    }
                    return;
                }

                // 检查是否在新建模式
                if (window.newEntryMode && window.newEntryMode.side === 'single') {
                    const index = parseInt(parentJQuery(this).data('index'));
                    executeNewEntryAtPosition(window.newEntryMode.apiInfo, 'single', index);
                    return;
                }

                // 正常的选择模式
                const checkbox = parentJQuery(this).find('.entry-checkbox');
                checkbox.prop('checked', !checkbox.prop('checked')).trigger('change');
            }
        });
    }, 50);
}

function updateDualSelectionCount() {
    const $ = getJQuery();

    // 左侧计数
    const leftTotal = $('#left-entries-list .entry-checkbox').length;
    const leftSelected = $('#left-entries-list .entry-checkbox:checked').length;
    $('#left-selection-count').text(`已选择 ${leftSelected}/${leftTotal}`);

    // 右侧计数
    const rightTotal = $('#right-entries-list .entry-checkbox').length;
    const rightSelected = $('#right-entries-list .entry-checkbox:checked').length;
    $('#right-selection-count').text(`已选择 ${rightSelected}/${rightTotal}`);

    // 更新按钮状态
    $('#left-edit').prop('disabled', leftSelected !== 1);
    $('#left-delete').prop('disabled', leftSelected === 0);
    $('#transfer-to-right').prop('disabled', leftSelected === 0 || !$('#right-preset').val());
    $('#left-smart-transfer').prop('disabled', leftSelected === 0 || !$('#right-preset').val());

    $('#right-edit').prop('disabled', rightSelected !== 1);
    $('#right-delete').prop('disabled', rightSelected === 0);
    $('#transfer-to-left').prop('disabled', rightSelected === 0 || !$('#left-preset').val());
    $('#right-smart-transfer').prop('disabled', rightSelected === 0 || !$('#left-preset').val());
}

function filterDualEntries(searchTerm) {
    const term = searchTerm.toLowerCase();
    const $ = getJQuery();

    // 清除之前的搜索结果
    clearSearchResults();

    if (!term) {
        // 如果搜索词为空，显示所有条目
        $('#left-entries-list .entry-item, #right-entries-list .entry-item, #single-entries-list .entry-item').each(function() {
            const $item = $(this);
            if (!$item.hasClass('position-item')) {
                $item.show();
            }
        });
        return;
    }

    // 过滤双预设界面
    $('#left-entries-list .entry-item, #right-entries-list .entry-item').each(function() {
        const $item = $(this);
        if (!$item.hasClass('position-item')) {
            const name = $item.find('.entry-name').text().toLowerCase();
            const matches = name.includes(term);
            $item.toggle(matches);

            if (matches) {
                addJumpButton($item);
            }
        }
    });

    // 过滤单预设界面
    $('#single-entries-list .entry-item').each(function() {
        const $item = $(this);
        if (!$item.hasClass('position-item')) {
            const name = $item.find('.entry-name').text().toLowerCase();
            const matches = name.includes(term);
            $item.toggle(matches);

            if (matches) {
                addJumpButton($item);
            }
        }
    });
}

function filterSideEntries(side, searchTerm) {
    const term = searchTerm.toLowerCase();
    const $ = getJQuery();

    // 清除指定侧的搜索结果
    clearSearchResults(side);

    if (!term) {
        // 如果搜索词为空，显示所有条目
        $(`#${side}-entries-list .entry-item`).each(function() {
            const $item = $(this);
            if (!$item.hasClass('position-item')) {
                $item.show();
            }
        });
        return;
    }

    // 只过滤指定侧的条目
    $(`#${side}-entries-list .entry-item`).each(function() {
        const $item = $(this);
        if (!$item.hasClass('position-item')) {
            const name = $item.find('.entry-name').text().toLowerCase();
            const matches = name.includes(term);
            $item.toggle(matches);

            if (matches) {
                addJumpButton($item);
            }
        }
    });
}

// 搜索跳转功能相关函数
function addJumpButton($item) {
    const $ = getJQuery();

    // 检查是否已经有跳转按钮
    if ($item.find('.jump-btn').length > 0) {
        return;
    }

    // 创建跳转按钮
    const $jumpBtn = $(`
        <button class="jump-btn" title="跳转到原位置">
            <span class="jump-icon">↗</span>
        </button>
    `);

    // 添加点击事件
    $jumpBtn.on('click', function(e) {
        e.stopPropagation();
        jumpToOriginalPosition($item);
    });

    // 将按钮添加到条目右侧（直接添加到条目容器）
    $item.append($jumpBtn);
}

function clearSearchResults(side = null) {
    const $ = getJQuery();

    if (side) {
        // 清除指定侧的跳转按钮
        $(`#${side}-entries-list .jump-btn`).remove();
    } else {
        // 清除所有跳转按钮
        $('.jump-btn').remove();
    }
}

function jumpToOriginalPosition($searchItem) {
    const $ = getJQuery();
    const identifier = $searchItem.data('identifier');

    if (!identifier) return;

    // 确定是哪个列表
    let listSelector = '';
    if ($searchItem.closest('#left-entries-list').length > 0) {
        listSelector = '#left-entries-list';
    } else if ($searchItem.closest('#right-entries-list').length > 0) {
        listSelector = '#right-entries-list';
    } else if ($searchItem.closest('#single-entries-list').length > 0) {
        listSelector = '#single-entries-list';
    }

    if (!listSelector) return;

    // 临时显示所有条目以找到原始位置
    const $allItems = $(`${listSelector} .entry-item`);
    $allItems.show();

    // 找到对应的原始条目
    const $originalItem = $allItems.filter(function() {
        return $(this).data('identifier') === identifier && !$(this).hasClass('position-item');
    }).first();

    if ($originalItem.length > 0) {
        // 滚动到原始位置
        $originalItem[0].scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });

        // 高亮显示目标条目
        $originalItem.addClass('jump-highlight');
        setTimeout(() => {
            $originalItem.removeClass('jump-highlight');
        }, 2000);

        // 清空搜索栏并恢复完整列表显示
        setTimeout(() => {
            const searchInput = getActiveSearchInput(listSelector);
            if (searchInput && searchInput.val()) {
                searchInput.val(''); // 清空搜索栏

                // 显示所有条目
                if (listSelector === '#left-entries-list') {
                    filterSideEntries('left', '');
                } else if (listSelector === '#right-entries-list') {
                    filterSideEntries('right', '');
                } else {
                    filterDualEntries('');
                }
            }
        }, 100);
    }
}

function getActiveSearchInput(listSelector) {
    const $ = getJQuery();

    if (listSelector === '#left-entries-list') {
        return $('#left-entry-search-inline').is(':visible') ? $('#left-entry-search-inline') : $('#left-entry-search');
    } else if (listSelector === '#right-entries-list') {
        return $('#right-entry-search-inline');
    } else {
        return $('#entry-search');
    }
}

function getSelectedEntries(side) {
    const selected = [];
    let entries, listSelector;

    if (side === 'single') {
        entries = window.singleEntries;
        listSelector = '#single-entries-list';
    } else {
        entries = side === 'left' ? window.leftEntries : window.rightEntries;
        listSelector = `#${side}-entries-list`;
    }

    const indices = [];

    // 收集所有选中的索引
    getJQuery()(`${listSelector} .entry-checkbox:checked`).each(function() {
        const index = parseInt($(this).closest('.entry-item').data('index'));
        if (!isNaN(index)) {
            indices.push(index);
        }
    });

    // 按索引顺序排序，保持原始顺序
    indices.sort((a, b) => a - b);

    // 按排序后的索引获取条目
    indices.forEach(index => {
        if (entries && entries[index]) {
            selected.push(entries[index]);
        }
    });

    return selected;
}

function updateSingleSelectionCount() {
    const $ = getJQuery();

    const total = $('#single-entries-list .entry-checkbox').length;
    const selected = $('#single-entries-list .entry-checkbox:checked').length;
    $('#single-selection-count').text(`已选择 ${selected}/${total}`);

    // 更新按钮状态
    $('#single-edit').prop('disabled', selected !== 1);
    $('#single-delete').prop('disabled', selected === 0);
}

function updateCompareButton() {
    const $ = getJQuery();
    const leftPreset = $('#left-preset').val();
    const rightPreset = $('#right-preset').val();

    // 只有两个预设都选择了才能比较
    const canCompare = leftPreset && rightPreset && leftPreset !== rightPreset;
    $('#compare-entries').prop('disabled', !canCompare);
}

function startTransferMode(apiInfo, fromSide, toSide) {
    const $ = getJQuery();
    const selectedEntries = getSelectedEntries(fromSide);
    const toPreset = $(`#${toSide}-preset`).val();

    if (selectedEntries.length === 0) {
        alert('请至少选择一个条目进行转移');
        return;
    }

    if (!toPreset) {
        alert('请选择目标预设');
        return;
    }

    // 设置转移模式
    window.transferMode = {
        apiInfo: apiInfo,
        fromSide: fromSide,
        toSide: toSide,
        selectedEntries: selectedEntries
    };

    // 更新UI提示
    alert(`转移模式已激活！请点击${toSide === 'left' ? '左侧' : '右侧'}面板中的条目来选择插入位置。`);

    // 高亮目标面板
    $(`#${toSide}-side`).addClass('transfer-target');
    $(`#${fromSide}-side`).addClass('transfer-source');
}

function startSmartTransferMode(apiInfo, fromSide, toSide) {
    const $ = getJQuery();
    const selectedEntries = getSelectedEntries(fromSide);
    const toPreset = $(`#${toSide}-preset`).val();

    if (selectedEntries.length === 0) {
        alert('请至少选择一个条目进行转移');
        return;
    }

    if (!toPreset) {
        alert('请选择目标预设');
        return;
    }

    try {
        // 获取目标预设的条目
        const toPresetData = getPresetDataFromManager(apiInfo, toPreset);
        const targetEntries = getPromptEntries(toPresetData);

        // 找到最佳插入位置
        const insertionPlan = findBestInsertPosition(selectedEntries, targetEntries);

        // 显示智能转移预览
        showSmartTransferPreview(apiInfo, fromSide, toSide, insertionPlan);

    } catch (error) {
        console.error('智能转移失败:', error);
        alert('智能转移失败: ' + error.message);
    }
}

function showSmartTransferPreview(apiInfo, fromSide, toSide, insertionPlan) {
    const $ = getJQuery();
    const { isMobile, isSmallScreen, isPortrait } = getDeviceInfo();

    // 移除已存在的预览模态框
    $('#smart-transfer-modal').remove();

    const fromPreset = $(`#${fromSide}-preset`).val();
    const toPreset = $(`#${toSide}-preset`).val();

    const modalHtml = `
        <div id="smart-transfer-modal">
            <div class="smart-transfer-modal-content">
                <div class="smart-transfer-header">
                    <div>
                        <span>🎯</span>
                        <h2>智能转移预览</h2>
                        <button class="close-smart-transfer-btn" id="close-smart-transfer-header">❌</button>
                    </div>
                    <div class="transfer-info">从 ${fromPreset} 转移到 ${toPreset}</div>
                </div>
                <div class="transfer-plan">
                    <h3>📋 转移计划</h3>
                    <div class="plan-list">
                        ${insertionPlan.map((plan, index) => `
                            <div class="plan-item">
                                <div class="plan-entry">
                                    <strong>${plan.entry.name}</strong>
                                </div>
                                <div class="plan-position">
                                    ${plan.positionText}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="smart-transfer-actions">
                    <button id="execute-smart-transfer" class="execute-btn">✅ 执行转移</button>
                    <button id="cancel-smart-transfer" class="cancel-btn">❌ 取消</button>
                </div>
            </div>
        </div>
    `;

    $('body').append(modalHtml);
    applySmartTransferStyles(isMobile, isSmallScreen, isPortrait);
    bindSmartTransferEvents(apiInfo, fromSide, toSide, insertionPlan);
}

function applySmartTransferStyles(isMobile, isSmallScreen, isPortrait) {
    const isDark = isDarkTheme();
    const bgColor = isDark ? '#1a1a1a' : '#ffffff';
    const textColor = isDark ? '#e0e0e0' : '#374151';
    const borderColor = isDark ? '#374151' : '#e5e7eb';
    const sectionBg = isDark ? '#262626' : '#f9fafb';

    const styles = `
        #smart-transfer-modal {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
            z-index: 10003; display: flex; align-items: ${isMobile ? 'flex-start' : 'center'};
            justify-content: center; padding: ${isMobile ? '10px' : '20px'};
            ${isMobile ? 'padding-top: 20px;' : ''}
            overflow-y: auto; -webkit-overflow-scrolling: touch; animation: pt-fadeIn 0.3s ease-out;
        }
        #smart-transfer-modal .smart-transfer-modal-content {
            background: ${bgColor}; border-radius: ${isMobile ? '16px' : '20px'};
            padding: ${isSmallScreen ? '24px' : isMobile ? '28px' : '32px'};
            max-width: ${isSmallScreen ? '95vw' : isMobile ? '90vw' : '600px'};
            width: ${isSmallScreen ? '95vw' : isMobile ? '90vw' : '90%'};
            max-height: ${isMobile ? '90vh' : '85vh'};
            overflow-y: auto; color: ${textColor}; box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            ${isMobile ? '-webkit-overflow-scrolling: touch;' : ''}
            animation: pt-slideUp 0.3s ease-out;
        }
        #smart-transfer-modal .smart-transfer-header {
            text-align: center; margin-bottom: ${isMobile ? '24px' : '28px'};
            padding-bottom: ${isMobile ? '18px' : '22px'}; border-bottom: 1px solid ${borderColor};
        }
        #smart-transfer-modal .smart-transfer-header > div:first-child {
            display: flex; align-items: center; justify-content: center;
            gap: 12px; padding: ${isMobile ? '8px 0' : '12px 0'}; position: relative;
        }
        #smart-transfer-modal .close-smart-transfer-btn {
            position: absolute; right: 0; top: 50%; transform: translateY(-50%);
            background: none; border: none; font-size: ${isMobile ? '18px' : '16px'};
            cursor: pointer; color: ${isDark ? '#9ca3af' : '#6b7280'}; padding: 4px;
        }
        #smart-transfer-modal .close-smart-transfer-btn:hover { color: ${textColor}; }
        #smart-transfer-modal .smart-transfer-header span { font-size: ${isSmallScreen ? '28px' : isMobile ? '32px' : '36px'}; }
        #smart-transfer-modal .smart-transfer-header h2 {
            margin: 0; font-size: ${isSmallScreen ? '22px' : isMobile ? '24px' : '28px'};
            font-weight: 700; color: ${isDark ? '#f3f4f6' : '#111827'}; letter-spacing: -0.5px;
        }
        #smart-transfer-modal .transfer-info {
            margin-top: 8px; font-size: ${isMobile ? '14px' : '13px'};
            color: ${isDark ? '#9ca3af' : '#6b7280'}; font-weight: 500;
        }
        #smart-transfer-modal .transfer-plan h3 {
            margin: 0 0 ${isMobile ? '16px' : '20px'} 0; font-size: ${isMobile ? '18px' : '20px'};
            font-weight: 600; color: ${textColor};
        }
        #smart-transfer-modal .plan-item {
            background: ${sectionBg}; border: 1px solid ${borderColor}; border-radius: 8px;
            padding: ${isMobile ? '12px' : '16px'}; margin-bottom: ${isMobile ? '8px' : '12px'};
        }
        #smart-transfer-modal .plan-entry {
            font-weight: 600; color: ${textColor}; font-size: ${isMobile ? '14px' : '16px'};
            margin-bottom: 4px;
        }
        #smart-transfer-modal .plan-position {
            font-size: ${isMobile ? '12px' : '13px'}; color: ${isDark ? '#9ca3af' : '#6b7280'};
        }
        #smart-transfer-modal .smart-transfer-actions {
            display: flex; justify-content: center; gap: ${isMobile ? '12px' : '16px'};
            margin-top: ${isMobile ? '24px' : '28px'}; padding-top: ${isMobile ? '20px' : '24px'};
            border-top: 1px solid ${borderColor};
        }
        #smart-transfer-modal .smart-transfer-actions button {
            padding: ${isMobile ? '12px 20px' : '14px 24px'}; border: none; border-radius: 8px;
            cursor: pointer; font-size: ${isMobile ? '14px' : '15px'}; font-weight: 600;
            transition: all 0.3s ease; letter-spacing: 0.3px;
        }
        #smart-transfer-modal .execute-btn {
            background: #059669; color: #ffffff;
        }
        #smart-transfer-modal .execute-btn:hover {
            background: #047857; transform: translateY(-1px);
        }
        #smart-transfer-modal .cancel-btn {
            background: #9ca3af; color: #ffffff;
        }
        #smart-transfer-modal .cancel-btn:hover {
            background: #6b7280; transform: translateY(-1px);
        }
    `;

    if (!$('#smart-transfer-modal-styles').length) {
        $('head').append(`<style id="smart-transfer-modal-styles">${styles}</style>`);
    }
}

function bindSmartTransferEvents(apiInfo, fromSide, toSide, insertionPlan) {
    const $ = getJQuery();
    const modal = $('#smart-transfer-modal');

    // 关闭按钮事件
    $('#cancel-smart-transfer, #close-smart-transfer-header').on('click', () => {
        modal.remove();
        $('#smart-transfer-modal-styles').remove();
    });

    // 执行转移按钮事件
    $('#execute-smart-transfer').on('click', async () => {
        try {
            $('#execute-smart-transfer').prop('disabled', true).text('转移中...');

            await executeSmartTransfer(apiInfo, fromSide, toSide, insertionPlan);

            alert(`成功转移 ${insertionPlan.length} 个条目！`);

            // 检查是否需要自动关闭模态框
            if ($('#auto-close-modal').prop('checked')) {
                $('#preset-transfer-modal').remove();
            } else {
                // 重新加载条目
                loadAndDisplayEntries(apiInfo);
            }

            modal.remove();
            $('#smart-transfer-modal-styles').remove();

        } catch (error) {
            console.error('智能转移执行失败:', error);
            alert('智能转移执行失败: ' + error.message);
            $('#execute-smart-transfer').prop('disabled', false).text('✅ 执行转移');
        }
    });

    // 点击模态框外部关闭
    modal.on('click', e => {
        if (e.target === modal[0]) {
            modal.remove();
            $('#smart-transfer-modal-styles').remove();
        }
    });

    // ESC键关闭模态框
    $(document).on('keydown.smart-transfer-modal', e => {
        if (e.key === 'Escape') {
            modal.remove();
            $('#smart-transfer-modal-styles').remove();
            $(document).off('keydown.smart-transfer-modal');
        }
    });
}

async function executeSmartTransfer(apiInfo, fromSide, toSide, insertionPlan) {
    const $ = getJQuery();
    const fromPreset = $(`#${fromSide}-preset`).val();
    const toPreset = $(`#${toSide}-preset`).val();
    const displayMode = $(`#${toSide}-display-mode`).val();
    const autoEnable = $('#auto-enable-entry').prop('checked');

    // 按照计划逐个转移条目
    for (const plan of insertionPlan) {
        try {
            await performTransfer(
                apiInfo,
                fromPreset,
                toPreset,
                [plan.entry],
                plan.position,
                autoEnable,
                displayMode
            );
        } catch (error) {
            console.error(`转移条目 "${plan.entry.name}" 失败:`, error);
            throw new Error(`转移条目 "${plan.entry.name}" 失败: ${error.message}`);
        }
    }
}

function startNewEntryMode(apiInfo, side) {
    const $ = getJQuery();
    let presetName;

    if (side === 'single') {
        presetName = window.singlePresetName;
    } else {
        presetName = $(`#${side}-preset`).val();
    }

    if (!presetName) {
        alert('请先选择预设');
        return;
    }

    // 设置新建模式
    window.newEntryMode = {
        apiInfo: apiInfo,
        side: side,
        presetName: presetName
    };

    // 更新UI提示
    let sideText = side === 'single' ? '当前' : (side === 'left' ? '左侧' : '右侧');
    alert(`新建模式已激活！请点击${sideText}面板中的条目来选择插入位置。`);

    // 高亮当前面板
    $(`#${side}-side`).addClass('new-entry-target');
}

async function executeTransferToPosition(apiInfo, fromSide, toSide, targetPosition) {
    const $ = getJQuery();
    const selectedEntries = window.transferMode.selectedEntries;
    const fromPreset = $(`#${fromSide}-preset`).val();
    const toPreset = $(`#${toSide}-preset`).val();
    const displayMode = $(`#${toSide}-display-mode`).val();

    try {
        // 构建插入位置
        let insertPosition;
        if (typeof targetPosition === 'string') {
            insertPosition = targetPosition; // 'top' 或 'bottom'
        } else {
            insertPosition = `after-${targetPosition}`;
        }

        // 执行转移
        const autoEnable = $('#auto-enable-entry').prop('checked');
        await performTransfer(apiInfo, fromPreset, toPreset, selectedEntries, insertPosition, autoEnable, displayMode);

        let successMessage = `成功转移 ${selectedEntries.length} 个条目！`;
        alert(successMessage);

        // 检查是否需要自动关闭模态框
        if ($('#auto-close-modal').prop('checked')) {
            $('#preset-transfer-modal').remove();
            return;
        }

        // 刷新界面
        loadAndDisplayEntries(apiInfo);

    } catch (error) {
        console.error('转移失败:', error);
        alert('转移失败: ' + error.message);
    } finally {
        // 重置转移模式
        window.transferMode = null;
        $('.transfer-target, .transfer-source').removeClass('transfer-target transfer-source');
    }
}

function executeNewEntryAtPosition(apiInfo, side, targetPosition) {
    const $ = getJQuery();
    let presetName;
    let displayMode;

    if (side === 'single') {
        presetName = window.singlePresetName;
        displayMode = $('#single-display-mode').val();
    } else {
        presetName = window.newEntryMode.presetName;
        displayMode = $(`#${side}-display-mode`).val();
    }

    // 构建插入位置
    let insertPosition;
    if (typeof targetPosition === 'string') {
        insertPosition = targetPosition; // 'top' 或 'bottom'
    } else {
        insertPosition = `after-${targetPosition}`;
    }

    const defaultEntry = {
        name: '新提示词',
        content: '',
        role: 'system',
        injection_depth: 4,
        injection_position: null, // Default to relative
        forbid_overrides: false,
        isNewEntry: true
    };

    // 重置新建模式
    window.newEntryMode = null;
    $('.new-entry-target').removeClass('new-entry-target');

    // 打开编辑模态框
    const autoEnable = $('#auto-enable-entry').prop('checked');
    createEditEntryModal(apiInfo, presetName, defaultEntry, insertPosition, autoEnable, side, null, displayMode);
}

function highlightDiff(base, compare) {
    const t1 = base || '';
    const t2 = compare || '';
    if (t1 === t2) return t2;

    const len1 = t1.length;
    const len2 = t2.length;
    let start = 0;
    while (start < len1 && start < len2 && t1[start] === t2[start]) {
        start++;
    }

    let end1 = len1;
    let end2 = len2;
    while (end1 > start && end2 > start && t1[end1 - 1] === t2[end2 - 1]) {
        end1--;
        end2--;
    }

    return t2.substring(0, start) +
           '<span class="diff-highlight">' +
           t2.substring(start, end2) +
           '</span>' +
           t2.substring(end2);
}

function shouldHighlightPositionDifference(leftPosition, rightPosition) {
    // 标准化位置值，空值或undefined视为relative
    const normalizePosition = (pos) => pos || 'relative';
    const left = normalizePosition(leftPosition);
    const right = normalizePosition(rightPosition);

    // 如果两个位置都是relative，不标红
    if (left === 'relative' && right === 'relative') {
        return false;
    }

    // 其他情况下，如果位置不同就标红
    return left !== right;
}

function showConfirmDialog(message, onConfirm) {
    const $ = getJQuery();
    $('#confirm-dialog-modal').remove();

    const { isMobile, isSmallScreen } = getDeviceInfo();

    const modalHtml = `
        <div id="confirm-dialog-modal">
            <div class="confirm-dialog-content">
                <div class="confirm-dialog-header">
                    <h4>
                        <span>⚠️</span>
                        确认操作
                    </h4>
                </div>
                <div class="confirm-dialog-body">
                    <p>${message}</p>
                </div>
                <div class="confirm-dialog-actions">
                    <button id="confirm-dialog-ok">✅ 确认</button>
                    <button id="confirm-dialog-cancel">❌ 取消</button>
                </div>
            </div>
        </div>
    `;
    $('body').append(modalHtml);

    const styles = `
        #confirm-dialog-modal {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
            z-index: 10003; display: flex; align-items: center; justify-content: center;
            padding: 20px; animation: pt-fadeIn 0.2s ease-out;
        }
        #confirm-dialog-modal .confirm-dialog-content {
            background: #ffffff; border-radius: 16px; padding: 24px;
            max-width: 400px; width: 90%; color: #374151;
            box-shadow: 0 10px 30px rgba(0,0,0,0.15); animation: pt-slideUp 0.2s ease-out;
        }
        #confirm-dialog-modal .confirm-dialog-header {
            margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #e5e7eb;
        }
        #confirm-dialog-modal .confirm-dialog-header h4 {
            margin: 0; font-size: 18px; font-weight: 700; color: #111827;
            display: flex; align-items: center; gap: 8px;
        }
        #confirm-dialog-modal .confirm-dialog-body p {
            margin: 0; font-size: 15px; line-height: 1.6; color: #4b5563;
        }
        #confirm-dialog-modal .confirm-dialog-actions {
            display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;
        }
        #confirm-dialog-modal .confirm-dialog-actions button {
            padding: 10px 18px; border: none; border-radius: 8px; cursor: pointer;
            font-size: 14px; font-weight: 600; transition: all 0.2s ease;
        }
        #confirm-dialog-modal #confirm-dialog-ok { background: #dc2626; color: #ffffff; }
        #confirm-dialog-modal #confirm-dialog-cancel { background: #e5e7eb; color: #4b5563; }
    `;
    if (!$('#confirm-dialog-styles').length) {
        $('head').append(`<style id="confirm-dialog-styles">${styles}</style>`);
    }

    $('#confirm-dialog-ok').on('click', function() {
        $(this).prop('disabled', true).text('处理中...');
        onConfirm();
        $('#confirm-dialog-modal').remove();
    });
    $('#confirm-dialog-cancel').on('click', function() {
        $('#confirm-dialog-modal').remove();
    });
}

function isEntryDifferent(leftEntry, rightEntry) {
    const left = ensureNewVersionFields(leftEntry);
    const right = ensureNewVersionFields(rightEntry);

    // 标准化位置值
    const normalizePosition = (pos) => pos || 'relative';
    const leftPos = normalizePosition(left.injection_position);
    const rightPos = normalizePosition(right.injection_position);

    const positionDifferent = (leftPos === 'relative' && rightPos === 'relative') ? false : (leftPos !== rightPos);

    const triggersDifferent = JSON.stringify([...(left.injection_trigger || [])].sort()) !== JSON.stringify([...(right.injection_trigger || [])].sort());

    return left.content !== right.content ||
           left.role !== right.role ||
           positionDifferent ||
           left.injection_depth !== right.injection_depth ||
           left.forbid_overrides !== right.forbid_overrides ||
           left.injection_order !== right.injection_order ||
           triggersDifferent;
}

function showCompareModal(apiInfo) {
    const $ = getJQuery();
    const leftPreset = $('#left-preset').val();
    const rightPreset = $('#right-preset').val();

    if (!leftPreset || !rightPreset || leftPreset === rightPreset) {
        alert('请选择两个不同的预设进行比较');
        return;
    }

    try {
        const leftData = getPresetDataFromManager(apiInfo, leftPreset);
        const rightData = getPresetDataFromManager(apiInfo, rightPreset);
        const leftEntries = getPromptEntries(leftData);
        const rightEntries = getPromptEntries(rightData);

        // 找到同名条目
        const commonEntries = [];
        leftEntries.forEach(leftEntry => {
            const rightEntry = rightEntries.find(r => r.name === leftEntry.name);
            if (rightEntry) {
                const isDifferent = isEntryDifferent(leftEntry, rightEntry);
                commonEntries.push({
                    name: leftEntry.name,
                    left: leftEntry,
                    right: rightEntry,
                    isDifferent: isDifferent
                });
            }
        });

        if (commonEntries.length === 0) {
            alert('两个预设中没有同名条目可以比较');
            return;
        }

        createCompareModal(apiInfo, leftPreset, rightPreset, commonEntries);

    } catch (error) {
        console.error('比较失败:', error);
        alert('比较失败: ' + error.message);
    }
}

function createCompareModal(apiInfo, leftPreset, rightPreset, commonEntries) {
    const $ = getJQuery();
    const { isMobile, isSmallScreen, isPortrait } = getDeviceInfo();

    // 移除已存在的比较模态框
    $('#compare-modal').remove();

    const differentEntries = commonEntries.filter(e => e.isDifferent);
    const sameEntries = commonEntries.filter(e => !e.isDifferent);

    const modalHtml = `
        <div id="compare-modal">
            <div class="compare-modal-content">
                <div class="compare-modal-header">
                    <div>
                        <span>🔍</span>
                        <h2>预设比较</h2>
                        <button class="close-compare-btn" id="close-compare-header">❌</button>
                    </div>
                    <div class="compare-info">${leftPreset} vs ${rightPreset}</div>
                </div>
                <div class="compare-stats">
                    <div class="stat-item">
                        <span class="stat-number different">${differentEntries.length}</span>
                        <span class="stat-label">差异条目</span>
                    </div>
                </div>
                <div class="compare-content">
                    ${differentEntries.length > 0 ? `
                        <h3>🔴 差异条目</h3>
                        <div class="compare-entries">
                            ${differentEntries.map(entry => createCompareEntryHtml(entry, leftPreset, rightPreset)).join('')}
                        </div>
                    ` : `
                        <div class="no-diff-message" style="text-align: center; padding: 40px 20px; color: #6b7280;">
                            <div style="font-size: 48px; margin-bottom: 15px; opacity: 0.5;">✅</div>
                            <div>两个预设之间没有发现差异。</div>
                        </div>
                    `}
                </div>
                <div class="compare-modal-actions">
                    <button id="close-compare">❌ 关闭</button>
                </div>
            </div>
        </div>
    `;

    $('body').append(modalHtml);
    $('#compare-modal').data({apiInfo, leftPreset, rightPreset, commonEntries});
    applyCompareModalStyles(isMobile, isSmallScreen, isPortrait);
    bindCompareModalEvents(apiInfo, leftPreset, rightPreset, commonEntries);
}

function createCompareEntryHtml(entry, leftPreset, rightPreset) {
    const left = ensureNewVersionFields(entry.left);
    const right = ensureNewVersionFields(entry.right);
    const leftContent = left.content || '';
    const rightContent = right.content || '';
    const triggersDifferent = JSON.stringify([...(left.injection_trigger || [])].sort()) !== JSON.stringify([...(right.injection_trigger || [])].sort());

    return `
        <div class="compare-entry">
            <div class="compare-entry-header">
                <h4>${entry.name}</h4>
                ${entry.isDifferent ? `
                    <div class="compare-actions">
                        <button class="compare-action-btn" data-action="copy-right-to-left" data-entry-name="${entry.name}">
                            覆盖左侧 ⬅️
                        </button>
                        <button class="compare-action-btn" data-action="copy-left-to-right" data-entry-name="${entry.name}">
                            ➡️ 覆盖右侧
                        </button>
                        <button class="compare-action-btn edit-btn" data-action="edit-left" data-entry-name="${entry.name}">
                            ✏️ 编辑左侧
                        </button>
                        <button class="compare-action-btn edit-btn" data-action="edit-right" data-entry-name="${entry.name}">
                            ✏️ 编辑右侧
                        </button>
                    </div>
                ` : ''}
            </div>
            <div class="compare-sides">
                <div class="compare-side left-side">
                    <h5>${leftPreset}</h5>
                    <div class="compare-details">
                        <div class="detail-row">
                            <span class="label">角色:</span>
                            <span class="value ${entry.left.role !== entry.right.role ? 'different' : ''}">${entry.left.role || 'system'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="label">位置:</span>
                            <span class="value ${shouldHighlightPositionDifference(entry.left.injection_position, entry.right.injection_position) ? 'different' : ''}">${entry.left.injection_position || 'relative'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="label">深度:</span>
                            <span class="value ${entry.left.injection_depth !== entry.right.injection_depth ? 'different' : ''}">${entry.left.injection_depth ?? 4}</span>
                        </div>
                        <div class="detail-row">
                            <span class="label">顺序:</span>
                            <span class="value ${left.injection_order !== right.injection_order ? 'different' : ''}">${left.injection_order}</span>
                        </div>
                        <div class="detail-row">
                            <span class="label">触发:</span>
                            <span class="value ${triggersDifferent ? 'different' : ''}">${left.injection_trigger.join(', ') || '无'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="label">内容:</span>
                            <div class="content-preview ${leftContent !== rightContent ? 'different' : ''}">
                                ${leftContent !== rightContent ? highlightDiff(rightContent, leftContent) : leftContent}
                            </div>
                        </div>
                    </div>
                </div>
                <div class="compare-side right-side">
                    <h5>${rightPreset}</h5>
                    <div class="compare-details">
                        <div class="detail-row">
                            <span class="label">角色:</span>
                            <span class="value ${entry.left.role !== entry.right.role ? 'different' : ''}">${entry.right.role || 'system'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="label">位置:</span>
                            <span class="value ${shouldHighlightPositionDifference(entry.left.injection_position, entry.right.injection_position) ? 'different' : ''}">${entry.right.injection_position || 'relative'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="label">深度:</span>
                            <span class="value ${entry.left.injection_depth !== entry.right.injection_depth ? 'different' : ''}">${entry.right.injection_depth ?? 4}</span>
                        </div>
                        <div class="detail-row">
                            <span class="label">顺序:</span>
                            <span class="value ${left.injection_order !== right.injection_order ? 'different' : ''}">${right.injection_order}</span>
                        </div>
                        <div class="detail-row">
                            <span class="label">触发:</span>
                            <span class="value ${triggersDifferent ? 'different' : ''}">${right.injection_trigger.join(', ') || '无'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="label">内容:</span>
                            <div class="content-preview ${leftContent !== rightContent ? 'different' : ''}">
                                ${leftContent !== rightContent ? highlightDiff(leftContent, rightContent) : rightContent}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function applyCompareModalStyles(isMobile, isSmallScreen, isPortrait) {
    const isDark = isDarkTheme();
    const bgColor = isDark ? '#1a1a1a' : '#ffffff';
    const textColor = isDark ? '#e0e0e0' : '#374151';
    const borderColor = isDark ? '#374151' : '#e5e7eb';
    const sectionBg = isDark ? '#262626' : '#f9fafb';

    const styles = `
        #compare-modal {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
            z-index: 10002; display: flex; align-items: ${isMobile ? 'flex-start' : 'center'};
            justify-content: center; padding: ${isMobile ? '10px' : '20px'};
            ${isMobile ? 'padding-top: 20px;' : ''}
            overflow-y: auto; -webkit-overflow-scrolling: touch; animation: pt-fadeIn 0.3s ease-out;
        }
        #compare-modal .compare-modal-content {
            background: ${bgColor}; border-radius: ${isMobile ? '16px' : '20px'};
            padding: ${isSmallScreen ? '24px' : isMobile ? '28px' : '32px'};
            max-width: ${isSmallScreen ? '95vw' : isMobile ? '90vw' : '900px'};
            width: ${isSmallScreen ? '95vw' : isMobile ? '90vw' : '90%'};
            max-height: ${isMobile ? '90vh' : '85vh'};
            overflow-y: auto; color: ${textColor}; box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            ${isMobile ? '-webkit-overflow-scrolling: touch;' : ''}
            animation: pt-slideUp 0.3s ease-out;
            transition: background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease;
        }
        #compare-modal .compare-modal-header {
            text-align: center; margin-bottom: ${isMobile ? '24px' : '28px'};
            padding-bottom: ${isMobile ? '18px' : '22px'}; border-bottom: 1px solid ${borderColor};
        }
        #compare-modal .compare-modal-header > div:first-child {
            display: flex; align-items: center; justify-content: center;
            gap: 12px; padding: ${isMobile ? '8px 0' : '12px 0'}; position: relative;
        }
        #compare-modal .close-compare-btn {
            position: absolute; right: 0; top: 50%; transform: translateY(-50%);
            background: none; border: none; font-size: ${isMobile ? '18px' : '16px'};
            cursor: pointer; color: ${isDark ? '#9ca3af' : '#6b7280'}; padding: 4px;
        }
        #compare-modal .close-compare-btn:hover { color: ${textColor}; }
        #compare-modal .compare-modal-header span { font-size: ${isSmallScreen ? '28px' : isMobile ? '32px' : '36px'}; }
        #compare-modal .compare-modal-header h2 {
            margin: 0; font-size: ${isSmallScreen ? '22px' : isMobile ? '24px' : '28px'};
            font-weight: 700; color: ${isDark ? '#f3f4f6' : '#111827'}; letter-spacing: -0.5px;
        }
        #compare-modal .compare-info {
            margin-top: 8px; font-size: ${isMobile ? '14px' : '13px'};
            color: ${isDark ? '#9ca3af' : '#6b7280'}; font-weight: 500;
        }
        #compare-modal .compare-stats {
            display: flex; justify-content: center; gap: ${isMobile ? '20px' : '30px'};
            margin-bottom: ${isMobile ? '24px' : '28px'}; flex-wrap: wrap;
        }
        #compare-modal .stat-item {
            text-align: center; padding: ${isMobile ? '12px' : '16px'};
            background: ${sectionBg}; border-radius: 12px; min-width: ${isMobile ? '80px' : '100px'};
        }
        #compare-modal .stat-number {
            display: block; font-size: ${isMobile ? '24px' : '28px'}; font-weight: 700;
            color: ${textColor}; margin-bottom: 4px;
        }
        #compare-modal .stat-number.different { color: #dc2626; }
        #compare-modal .stat-number.same { color: #059669; }
        #compare-modal .stat-label {
            font-size: ${isMobile ? '12px' : '11px'}; color: ${isDark ? '#9ca3af' : '#6b7280'}; font-weight: 500;
        }
        #compare-modal .compare-content h3 {
            margin: ${isMobile ? '24px 0 16px' : '28px 0 20px'}; font-size: ${isMobile ? '18px' : '20px'};
            font-weight: 600; color: ${textColor};
        }
        #compare-modal .compare-entry {
            border: 1px solid ${borderColor}; border-radius: 12px; margin-bottom: ${isMobile ? '16px' : '20px'};
            background: ${bgColor}; overflow: hidden;
        }
        #compare-modal .compare-entry-header {
            background: ${sectionBg}; padding: ${isMobile ? '12px 16px' : '14px 20px'};
            border-bottom: 1px solid ${borderColor};
        }
        #compare-modal .compare-entry-header {
            display: flex; justify-content: space-between; align-items: center;
            flex-wrap: wrap; gap: ${isMobile ? '8px' : '12px'};
        }
        #compare-modal .compare-entry-header h4 {
            margin: 0; font-size: ${isMobile ? '16px' : '18px'}; font-weight: 600; color: ${textColor};
            flex: 1; min-width: 0;
        }
        #compare-modal .compare-actions {
            display: flex; gap: ${isMobile ? '6px' : '8px'}; flex-wrap: wrap;
            ${isMobile ? 'display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;' : ''}
        }
        #compare-modal .compare-action-btn {
            padding: ${isMobile ? '4px 8px' : '6px 10px'}; border: 1px solid ${isDark ? '#4b5563' : '#d1d5db'};
            background: ${isDark ? '#374151' : '#ffffff'}; color: ${textColor}; border-radius: 6px; cursor: pointer;
            font-size: ${isMobile ? '11px' : '12px'}; font-weight: 500;
            transition: all 0.2s ease; white-space: nowrap;
        }
        #compare-modal .compare-action-btn:hover {
            background: ${isDark ? '#4b5563' : '#f3f4f6'}; border-color: ${isDark ? '#6b7280' : '#9ca3af'};
        }
        #compare-modal .compare-action-btn.edit-btn {
            background: ${isDark ? '#1e3a8a' : '#dbeafe'}; border-color: #3b82f6; color: ${isDark ? '#93c5fd' : '#1d4ed8'};
        }
        #compare-modal .compare-action-btn.edit-btn:hover {
            background: ${isDark ? '#1e40af' : '#bfdbfe'};
        }
        #compare-modal .compare-sides {
            display: ${isMobile ? 'flex' : 'grid'};
            ${isMobile ? 'flex-direction: column;' : 'grid-template-columns: 1fr 1fr;'}
        }
        #compare-modal .compare-side {
            padding: ${isMobile ? '16px' : '20px'};
        }
        #compare-modal .compare-side.right-side {
            border-left: ${isMobile ? 'none' : `1px solid ${borderColor}`};
            border-top: ${isMobile ? `1px solid ${borderColor}` : 'none'};
        }
        #compare-modal .compare-side h5 {
            margin: 0 0 ${isMobile ? '12px' : '16px'} 0; font-size: ${isMobile ? '14px' : '16px'};
            font-weight: 600; color: ${isDark ? '#9ca3af' : '#6b7280'};
        }
        #compare-modal .detail-row {
            margin-bottom: ${isMobile ? '8px' : '12px'}; display: flex; align-items: flex-start;
            gap: ${isMobile ? '4px' : '8px'};
            ${isMobile ? 'flex-direction: column; align-items: stretch;' : ''}
        }
        #compare-modal .detail-row .label {
            font-weight: 600; color: ${isDark ? '#9ca3af' : '#6b7280'}; font-size: ${isMobile ? '12px' : '13px'};
            min-width: ${isMobile ? '40px' : '50px'};
            ${isMobile ? 'margin-bottom: 2px;' : ''}
        }
        #compare-modal .detail-row .value {
            font-size: ${isMobile ? '12px' : '13px'}; color: ${textColor};
        }
        #compare-modal .detail-row .value.different {
            background: ${isDark ? '#7f1d1d' : '#fef2f2'}; color: #dc2626; padding: 2px 6px; border-radius: 4px;
            font-weight: 600;
        }
        #compare-modal .content-preview {
            background: ${isDark ? '#1f2937' : '#f9fafb'}; padding: ${isMobile ? '8px' : '10px'}; border-radius: 6px;
            font-size: ${isMobile ? '11px' : '12px'}; color: ${textColor}; line-height: 1.4;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace; white-space: pre-wrap;
            word-break: break-word; max-height: 100px; overflow-y: auto;
            ${isMobile ? 'max-height: 60px; width: 100%; min-height: 40px;' : ''}
            border: 1px solid ${isDark ? '#374151' : 'transparent'};
        }
        #compare-modal .content-preview.different {
            background: ${isDark ? '#5c1a1a' : '#fef2f2'}; border: 1px solid ${isDark ? '#dc2626' : '#fecaca'};
            color: ${isDark ? '#fecaca' : '#dc2626'} !important;
        }
        #compare-modal .diff-highlight {
            background-color: ${isDark ? '#8c2a2a' : '#ffcdd2'};
            color: ${isDark ? '#fee2e2' : '#c62828'};
            padding: 1px 3px;
            border-radius: 3px;
            font-weight: 600;
        }
        #compare-modal .same-entries {
            display: flex; flex-wrap: wrap; gap: ${isMobile ? '8px' : '10px'};
        }
        #compare-modal .same-entry {
            background: #ecfdf5; color: #059669; padding: ${isMobile ? '6px 12px' : '8px 16px'};
            border-radius: 20px; font-size: ${isMobile ? '12px' : '13px'}; font-weight: 500;
        }
        #compare-modal .compare-modal-actions {
            display: flex; justify-content: center; margin-top: ${isMobile ? '24px' : '28px'};
            padding-top: ${isMobile ? '20px' : '24px'}; border-top: 1px solid ${borderColor};
        }
        #compare-modal .compare-modal-actions button {
            padding: ${isMobile ? '14px 24px' : '12px 22px'}; border: none; color: #ffffff;
            border-radius: 8px; cursor: pointer; font-size: ${isMobile ? '15px' : '14px'};
            font-weight: 600; transition: all 0.3s ease; letter-spacing: 0.3px;
            background: #9ca3af; min-width: 100px;
        }
        #compare-modal button:hover { opacity: 0.9; }
    `;

    if (!$('#compare-modal-styles').length) {
        $('head').append(`<style id="compare-modal-styles">${styles}</style>`);
    }
}

function bindCompareModalEvents(apiInfo, leftPreset, rightPreset, commonEntries) {
    const $ = getJQuery();
    const modal = $('#compare-modal');

    // 关闭按钮事件
    $('#close-compare, #close-compare-header').on('click', () => modal.remove());

    // 操作按钮事件
    $('.compare-action-btn').on('click', function() {
        const action = $(this).data('action');
        const entryName = $(this).data('entry-name');
        const entry = commonEntries.find(e => e.name === entryName);

        if (!entry) return;

        switch (action) {
            case 'copy-left-to-right':
                showConfirmDialog(
                    `确定要用 <b>${leftPreset}</b> 的条目 "<b>${entryName}</b>" 覆盖 <b>${rightPreset}</b> 中的同名条目吗？此操作不可撤销。`,
                    () => copyEntryBetweenPresets(apiInfo, leftPreset, rightPreset, entry.left, entryName)
                );
                break;
            case 'copy-right-to-left':
                showConfirmDialog(
                    `确定要用 <b>${rightPreset}</b> 的条目 "<b>${entryName}</b>" 覆盖 <b>${leftPreset}</b> 中的同名条目吗？此操作不可撤销。`,
                    () => copyEntryBetweenPresets(apiInfo, rightPreset, leftPreset, entry.right, entryName)
                );
                break;
            case 'edit-left':
                modal.remove();
                editEntryInPreset(apiInfo, leftPreset, entry.left, entryName);
                break;
            case 'edit-right':
                modal.remove();
                editEntryInPreset(apiInfo, rightPreset, entry.right, entryName);
                break;
        }
    });

    // 点击背景关闭模态框
    modal.on('click', e => {
        if (e.target === modal[0]) modal.remove();
    });

    // ESC键关闭模态框
    $(document).on('keydown.compare-modal', e => {
        if (e.key === 'Escape') {
            modal.remove();
            $(document).off('keydown.compare-modal');
        }
    });

    // 移动端处理
    if (getDeviceInfo().isMobile) {
        const originalOverflow = $('body').css('overflow');
        $('body').css('overflow', 'hidden');
        modal.on('remove', () => $('body').css('overflow', originalOverflow));
    }

    modal.css('display', 'flex');
}

async function copyEntryBetweenPresets(apiInfo, fromPreset, toPreset, entryData, entryName) {
    try {
        const toPresetData = getPresetDataFromManager(apiInfo, toPreset);
        const targetPromptIndex = toPresetData.prompts.findIndex(p => p && p.name === entryName && !p.system_prompt && !p.marker);

        if (targetPromptIndex === -1) {
            throw new Error(`在预设 "${toPreset}" 中未找到目标条目 "${entryName}"`);
        }

        const originalIdentifier = toPresetData.prompts[targetPromptIndex].identifier;
        const newPromptData = ensureNewVersionFields(entryData);

        // Replace the old prompt object with the new one, preserving the identifier
        toPresetData.prompts[targetPromptIndex] = {
            ...newPromptData,
            identifier: originalIdentifier,
        };

        await apiInfo.presetManager.savePreset(toPreset, toPresetData);

        alert(`成功将 "${entryName}" 从 ${fromPreset} 覆盖到 ${toPreset}！`);

        // 刷新主界面和比较界面
        loadAndDisplayEntries(apiInfo);
        $('#compare-modal').remove();
        // 重新打开比较模态框以显示更新后的状态
        showCompareModal(apiInfo);

    } catch (error) {
        console.error('覆盖条目失败:', error);
        alert('覆盖条目失败: ' + error.message);
    }
}

function editEntryInPreset(apiInfo, presetName, entryData, entryName) {
    // 找到条目在预设中的索引
    const presetData = getPresetDataFromManager(apiInfo, presetName);
    const entries = getPromptEntries(presetData);
    const entryIndex = entries.findIndex(e => e.name === entryName);

    if (entryIndex === -1) {
        alert('条目未找到');
        return;
    }

    // 打开编辑模态框
    createEditEntryModal(apiInfo, presetName, entryData, null, false, null, entryIndex);
}

// 旧的插入选项函数已移除，使用新的点击模式

// 旧的转移函数已移除，使用新的点击模式

// 旧的新建函数已移除，使用新的点击模式

function editSelectedEntry(apiInfo, side) {
    const $ = getJQuery();
    const selectedEntries = getSelectedEntries(side);
    let presetName, entries, displayMode;

    if (side === 'single') {
        presetName = window.singlePresetName;
        entries = window.singleEntries;
        displayMode = $('#single-display-mode').val();
    } else {
        presetName = $(`#${side}-preset`).val();
        entries = side === 'left' ? window.leftEntries : window.rightEntries;
        displayMode = $(`#${side}-display-mode`).val();
    }

    if (selectedEntries.length !== 1) {
        alert('请选择一个条目进行编辑');
        return;
    }

    if (!presetName) {
        alert('请先选择预设');
        return;
    }

    const entry = selectedEntries[0];
    const entryIndex = entries.findIndex(e => e.name === entry.name && e.content === entry.content);

    createEditEntryModal(apiInfo, presetName, entry, null, false, side, entryIndex, displayMode);
}

async function deleteSelectedEntries(apiInfo, side) {
    const $ = getJQuery();
    const selectedEntries = getSelectedEntries(side);
    let presetName;

    if (side === 'single') {
        presetName = window.singlePresetName;
    } else {
        presetName = $(`#${side}-preset`).val();
    }

    if (selectedEntries.length === 0) {
        alert('请至少选择一个条目进行删除');
        return;
    }

    if (!presetName) {
        alert('请先选择预设');
        return;
    }

    showConfirmDialog(`确定要从预设 "${presetName}" 中删除 ${selectedEntries.length} 个条目吗？此操作不可撤销。`, async () => {
        try {
            const deleteButton = side === 'single' ? '#single-delete' : `#${side}-delete`;
            $(deleteButton).prop('disabled', true).text('删除中...');
            await performDelete(apiInfo, presetName, selectedEntries);
            alert(`成功删除 ${selectedEntries.length} 个条目！`);

            // 检查是否需要自动关闭模态框
            if ($('#auto-close-modal').prop('checked')) {
                $('#preset-transfer-modal').remove();
                return;
            }

            // 统一调用刷新函数，它会根据当前选择判断是单模式还是双模式
            loadAndDisplayEntries(apiInfo);
        } catch (error) {
            console.error('删除失败:', error);
            alert('删除失败: ' + error.message);
        } finally {
            const deleteButton = side === 'single' ? '#single-delete' : `#${side}-delete`;
            $(deleteButton).prop('disabled', false).text('🗑️ 删除');
            // 刷新计数和按钮状态
            updateDualSelectionCount();
            updateSingleSelectionCount();
        }
    });
}

async function transferEntries(apiInfo, fromSide, toSide) {
    const $ = getJQuery();
    const selectedEntries = getSelectedEntries(fromSide);
    const fromPreset = $(`#${fromSide}-preset`).val();
    const toPreset = $(`#${toSide}-preset`).val();
    const displayMode = $(`#${toSide}-display-mode`).val();

    if (selectedEntries.length === 0) {
        alert('请至少选择一个条目进行转移');
        return;
    }

    if (!fromPreset || !toPreset) {
        alert('请确保两侧都选择了预设');
        return;
    }

    if (fromPreset === toPreset) {
        alert('不能转移到相同的预设');
        return;
    }

    try {
        const transferBtn = $(`#transfer-to-${toSide}`);
        transferBtn.prop('disabled', true).text('转移中...');

        // 执行转移（插入到底部）
        const autoEnable = $('#auto-enable-entry').prop('checked');
        await performTransfer(apiInfo, fromPreset, toPreset, selectedEntries, 'bottom', autoEnable, displayMode);

        let successMessage = `成功转移 ${selectedEntries.length} 个条目！`;
        alert(successMessage);

        // 检查是否需要自动关闭模态框
        if ($('#auto-close-modal').prop('checked')) {
            $('#preset-transfer-modal').remove();
            return;
        }

        // 刷新界面
        loadAndDisplayEntries(apiInfo);

    } catch (error) {
        console.error('转移失败:', error);
        alert('转移失败: ' + error.message);
    } finally {
        const transferBtn = $(`#transfer-to-${toSide}`);
        const direction = toSide === 'left' ? '⬅️' : '➡️';
        transferBtn.prop('disabled', false).text(`${direction} 转移到${toSide === 'left' ? '左侧' : '右侧'}`);
    }
}

function analyzeTransferableEntries(sourceEntries, targetEntries) {
    const targetNames = new Set(targetEntries.map(entry => entry.name));
    return sourceEntries.map(sourceEntry => {
        const exists = targetNames.has(sourceEntry.name);
        const targetEntry = targetEntries.find(entry => entry.name === sourceEntry.name);
        let status = 'new';
        if (exists) {
            const sourceContent = JSON.stringify({ content: sourceEntry.content, role: sourceEntry.role, injection_depth: sourceEntry.injection_depth, injection_position: sourceEntry.injection_position });
            const targetContent = JSON.stringify({ content: targetEntry.content, role: targetEntry.role, injection_depth: targetEntry.injection_depth, injection_position: targetEntry.injection_position });
            status = sourceContent === targetContent ? 'same' : 'different';
        }
        return { ...sourceEntry, status, statusText: status === 'new' ? '新增' : status === 'different' ? '不同' : '相同', statusIcon: status === 'new' ? '🆕' : status === 'different' ? '🔄' : '✅' };
    });
}

function displayTransferableEntries(entries) {
    const $ = getJQuery();
    const entriesList = $('#entries-list');
    if (!entriesList.length) { console.error('条目列表容器未找到'); return; }

    const { isMobile, isSmallScreen } = getDeviceInfo();
    const isDark = isDarkTheme();

    // 深色主题颜色变量
    const entryBg = isDark ? '#2d2d2d' : '#ffffff';
    const entryBorder = isDark ? '#4b5563' : '#e5e7eb';
    const entryTextColor = isDark ? '#e0e0e0' : '#111827';
    const entryDetailsColor = isDark ? '#9ca3af' : '#6b7280';
    const emptyTextColor = isDark ? '#9ca3af' : '#6b7280';

    if (entries.length === 0) {
        entriesList.html(`<div style="color: ${emptyTextColor}; text-align: center; padding: ${isMobile ? '40px 20px' : '50px 20px'}; font-size: ${isMobile ? '16px' : '15px'}; font-weight: 500;"><div style="font-size: 64px; margin-bottom: 20px; opacity: 0.3;">📭</div><div>没有可转移的条目</div></div>`);
        return;
    }

    const entriesHtml = entries.map((entry, index) => {
        const statusColor = entry.status === 'new' ? '#10b981' : entry.status === 'different' ? '#f59e0b' : '#6b7280';
        const editButtonBg = isDark ? '#059669' : '#059669';
        const editButton = entry.showEditButton ? `<button class="entry-edit-btn" data-index="${index}" style="margin-left: 8px; padding: 6px 12px; background: ${editButtonBg}; color: white; border: none; border-radius: 6px; font-size: 12px; cursor: pointer; z-index: 10; position: relative;">✏️ 编辑</button>` : '';
        return `
            <div class="entry-item" data-index="${index}" data-identifier="${entry.identifier}" style="border-color: ${entryBorder}; background: ${entryBg}; transition: all 0.3s ease; cursor: pointer; position: relative; display: flex; align-items: ${isMobile ? 'flex-start' : 'center'}; padding: ${isSmallScreen ? '12px 10px' : isMobile ? '14px 12px' : '16px 18px'}; margin-bottom: ${isMobile ? '10px' : '10px'}; border: 1px solid ${entryBorder}; border-radius: ${isMobile ? '12px' : '10px'}; ${isMobile ? 'min-height: 60px;' : 'min-height: 56px;'}">
                <input type="checkbox" class="entry-checkbox" data-status="${entry.status}" style="margin-right: ${isMobile ? '12px' : '14px'}; ${isMobile ? 'margin-top: 4px;' : ''} width: ${isMobile ? '18px' : '18px'}; height: ${isMobile ? '18px' : '18px'}; accent-color: ${statusColor}; cursor: pointer; position: relative; z-index: 10;">
                <div style="flex: 1; ${isMobile ? 'min-width: 0;' : ''}">
                    <div class="entry-name" style="font-weight: 600; color: ${entryTextColor}; font-size: ${isSmallScreen ? '13px' : isMobile ? '14px' : '15px'}; margin-bottom: ${isMobile ? '4px' : '4px'}; word-break: break-word; line-height: 1.3;">${entry.name}</div>
                    <div class="entry-details" style="font-size: ${isSmallScreen ? '11px' : isMobile ? '12px' : '12px'}; color: ${entryDetailsColor}; line-height: 1.4; ${isMobile ? 'display: flex; flex-direction: column; gap: 2px;' : ''}">
                        <div class="status-info" style="display: inline-flex; align-items: center; gap: 6px;">
                            <span style="font-size: ${isMobile ? '13px' : '14px'};">${entry.statusIcon}</span>
                            <span style="color: ${statusColor}; font-weight: 500; padding: 2px 6px; background: ${statusColor}20; border-radius: 4px; font-size: ${isSmallScreen ? '10px' : isMobile ? '11px' : '12px'};">${entry.statusText}</span>
                        </div>
                        ${(entry.role || entry.injection_position != null) && !isMobile ? `<div class="meta-info" style="display: inline-flex; gap: 12px; margin-left: 8px; font-size: 11px; opacity: 0.8;">${entry.role ? `<span>👤 ${entry.role}</span>` : ''}<span>📍 ${entry.injection_position ?? 'relative'}</span></div>` : ''}
                    </div>
                </div>
                ${editButton}
            </div>`;
    }).join('');
    entriesList.html(entriesHtml);

    setTimeout(() => {
        const parentJQuery = getParentWindow().$;
        const entriesContainer = parentJQuery('#entries-list');
        entriesContainer.off('change', '.entry-checkbox').on('change', '.entry-checkbox', () => { updateSelectionCount(); updateExecuteButton(); });
        entriesContainer.off('click', '.entry-item').on('click', '.entry-item', function(e) {
            if (!parentJQuery(e.target).is('.entry-checkbox') && !parentJQuery(e.target).is('.entry-edit-btn')) {
                e.preventDefault();
                const checkbox = parentJQuery(this).find('.entry-checkbox');
                checkbox.prop('checked', !checkbox.prop('checked')).trigger('change');
            }
        });
        entriesContainer.off('click', '.entry-edit-btn').on('click', '.entry-edit-btn', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const index = parseInt(parentJQuery(this).data('index'));
            const entry = window.transferableEntries[index];
            const targetPreset = parentJQuery('#target-preset').val();
            const insertPosition = parentJQuery('#insert-position').val();
            const autoEnable = parentJQuery('#auto-enable-entry').prop('checked');

            if (entry && targetPreset) {
                createEditEntryModal(getCurrentApiInfo(), targetPreset, entry, insertPosition, autoEnable);
            }
        });
        updateSelectionCount();
        updateExecuteButton();
    }, 50);
}

function updateInsertPositionOptions(targetPreset, displayMode = 'default') {
    const $ = getJQuery();
    const insertSelect = $('#insert-position');
    insertSelect.empty().append('<option value="" disabled selected>请选择插入位置...</option><option value="top">插入到顶部</option><option value="bottom">插入到底部</option>');
    const targetOrderList = getTargetPromptsList(targetPreset, displayMode);
    if (targetOrderList.length > 0) {
        insertSelect.append('<option disabled>──────────</option>');
        targetOrderList.forEach((entry, index) => insertSelect.append(`<option value="after-${index}">插入到 "${entry.name}" 之后</option>`));
    }
    insertSelect.trigger('change');
}

function getTargetPromptsList(targetPreset, displayMode = 'default') {
    try {
        const apiInfo = getCurrentApiInfo();
        if (!apiInfo) return [];
        const presetData = getPresetDataFromManager(apiInfo, targetPreset);
        if (!presetData) return [];

        if (!presetData.prompts || !Array.isArray(presetData.prompts)) {
            return [];
        }

        const dummyCharacterId = 100001;
        const characterPromptOrder = presetData.prompt_order?.find(order => order.character_id === dummyCharacterId);

        if (!characterPromptOrder) {
            return getPromptEntries(presetData);
        }

        const orderedEntries = [];
        const promptMap = new Map(presetData.prompts.map(p => [p.identifier, p]));

        characterPromptOrder.order.forEach(orderEntry => {
            const prompt = promptMap.get(orderEntry.identifier);
            if (prompt && !prompt.system_prompt && !prompt.marker && prompt.name && prompt.name.trim() !== '') {
                if (displayMode === 'default' && !orderEntry.enabled) {
                    return; // Skip disabled
                }
                orderedEntries.push(prompt);
            }
        });
        return orderedEntries;

    } catch (error) {
        console.error('获取目标提示词列表失败:', error);
        return [];
    }
}

function filterEntries(searchTerm) {
    const term = searchTerm.toLowerCase();
    getJQuery()('#entries-list .entry-item').each(function() {
        const $item = $(this);
        const name = $item.find('.entry-name').text().toLowerCase();
        $item.toggle(name.includes(term));
    });
}

function updateSelectionCount() {
    const $ = getJQuery();
    const total = $('#entries-list .entry-checkbox').length;
    const selected = $('#entries-list .entry-checkbox:checked').length;
    $('#selection-count').text(`已选择 ${selected}/${total} 个条目`);
}

// 这些函数已被双侧模式替代，保留以防兼容性问题
function updateExecuteButton() {
    // 双侧模式下不再需要此函数
}

function updateExecuteButtonState() {
    // 双侧模式下不再需要此函数
}

// 旧版本的getSelectedEntries，保留以防兼容性问题
function getSelectedEntriesOld() {
    const selected = [];
    getJQuery()('#entries-list .entry-checkbox:checked').each(function() {
        const index = parseInt($(this).closest('.entry-item').data('index'));
        if (window.transferableEntries && window.transferableEntries[index]) {
            selected.push(window.transferableEntries[index]);
        }
    });
    return selected;
}

function getOrCreateDummyCharacterPromptOrder(presetData) {
    if (!presetData.prompt_order) {
        presetData.prompt_order = [];
    }
    const dummyCharacterId = 100001;
    let characterPromptOrder = presetData.prompt_order.find(order => order.character_id === dummyCharacterId);
    if (!characterPromptOrder) {
        characterPromptOrder = {
            character_id: dummyCharacterId,
            order: [
                { identifier: 'main', enabled: true },
                { identifier: 'worldInfoBefore', enabled: true },
                { identifier: 'personaDescription', enabled: true },
                { identifier: 'charDescription', enabled: true },
                { identifier: 'charPersonality', enabled: true },
                { identifier: 'scenario', enabled: true },
                { identifier: 'enhanceDefinitions', enabled: false },
                { identifier: 'nsfw', enabled: true },
                { identifier: 'worldInfoAfter', enabled: true },
                { identifier: 'dialogueExamples', enabled: true },
                { identifier: 'chatHistory', enabled: true },
                { identifier: 'jailbreak', enabled: true }
            ]
        };
        presetData.prompt_order.push(characterPromptOrder);
    }
    return characterPromptOrder;
}

// 旧的执行转移函数，已被双侧模式替代
async function executeTransfer(apiInfo) {
    // 此函数已被双侧模式的transferEntries函数替代
    alert('请使用新的双侧界面进行操作');
}

// 旧的执行删除函数，已被双侧模式替代
async function executeDelete(apiInfo) {
    // 此函数已被双侧模式的deleteSelectedEntries函数替代
    alert('请使用新的双侧界面进行操作');
}

// 旧的编辑函数已被移除，避免重复定义

function createEditEntryModal(apiInfo, presetName, entry, insertPosition = null, autoEnable = false, side = null, entryIndex = null, displayMode = 'default') {
    const $ = getJQuery();
    const { isMobile, isSmallScreen, isPortrait } = getDeviceInfo();

    // 移除已存在的编辑模态框
    $('#edit-entry-modal').remove();

    const isNewEntry = entry.isNewEntry || false;
    const modalTitle = isNewEntry ? '新建条目' : '编辑条目';
    const modalIcon = isNewEntry ? '✨' : '✏️';
    const isDark = isDarkTheme();
    const tipColor = isDark ? '#9ca3af' : '#6b7280';

    // 如果是新建条目，使用默认值；如果是编辑，使用现有值
    const entryData = isNewEntry ? createEntryWithNewFields({name: '新提示词'}) : ensureNewVersionFields(entry);

    const currentPosition = entryData.injection_position;
    // 使用宽松比较处理 '1' (字符串) 和 1 (数字) 的情况，并处理 null/undefined/空字符串
    const isRelative = currentPosition == 'relative' || currentPosition == null || currentPosition === '';
    const isChat = currentPosition == '1' || currentPosition == 'absolute';

    const positionOptions = [
        { value: 'relative', label: '相对', selected: isRelative },
        { value: '1', label: '聊天中', selected: isChat }
    ];

    const modalHtml = `
        <div id="edit-entry-modal">
            <div class="edit-modal-content">
                <div class="edit-modal-header">
                    <div>
                        <span>${modalIcon}</span>
                        <h2>${modalTitle}</h2>
                    </div>
                    <div class="preset-info">预设: ${presetName}</div>
                    <div class="edit-tip" style="margin-top: 8px; font-size: ${isMobile ? '12px' : '11px'}; color: ${tipColor}; text-align: center; opacity: 0.8;">
                        💡 提示：只能通过点击"取消"按钮关闭此界面，避免误触
                    </div>
                </div>
                <div class="edit-form">
                    <div class="form-field">
                        <label for="edit-entry-name">
                            <span>📝 条目名称</span>
                        </label>
                        <input type="text" id="edit-entry-name" value="${entryData.name}" placeholder="输入条目名称...">
                    </div>
                    <div class="form-field">
                        <label for="edit-entry-role">
                            <span>👤 角色</span>
                        </label>
                        <select id="edit-entry-role">
                            <option value="system" ${entryData.role === 'system' ? 'selected' : ''}>系统</option>
                            <option value="user" ${entryData.role === 'user' ? 'selected' : ''}>用户</option>
                            <option value="assistant" ${entryData.role === 'assistant' ? 'selected' : ''}>AI助手</option>
                        </select>
                    </div>
                    <div class="form-field">
                        <label for="edit-entry-position">
                            <span>📍 注入位置</span>
                        </label>
                        <select id="edit-entry-position">
                            ${positionOptions.map(opt => `<option value="${opt.value}" ${opt.selected ? 'selected' : ''}>${opt.label}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-field" id="depth-field" style="display: ${isChat ? 'block' : 'none'};">
                        <label for="edit-entry-depth">
                            <span>🔢 注入深度</span>
                        </label>
                        <input type="number" id="edit-entry-depth" value="${entryData.injection_depth}" min="0" max="100">
                    </div>
                    <div class="form-field">
                        <label for="edit-entry-content">
                            <span>📄 内容</span>
                        </label>
                        <textarea id="edit-entry-content" rows="8" placeholder="输入条目内容...">${entryData.content}</textarea>
                    </div>
                    <div class="form-field">
                        <label for="edit-entry-order">
                            <span>#️⃣ 注入顺序</span>
                        </label>
                        <input type="number" id="edit-entry-order" value="${entryData.injection_order}">
                    </div>
                    <div class="form-field">
                        <label>
                            <span>⚡️ 触发条件 (不选则为总是触发)</span>
                        </label>
                        <div id="edit-entry-triggers" class="trigger-container">
                            ${TRIGGER_TYPES.map(trigger => `
                                <label class="trigger-label">
                                    <input type="checkbox" class="trigger-checkbox" value="${trigger}" ${entryData.injection_trigger.includes(trigger) ? 'checked' : ''}>
                                    <span>${TRIGGER_TYPE_LABELS[trigger] || trigger}</span>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                </div>
                <div class="edit-modal-actions">
                    <button id="save-entry-changes">${isNewEntry ? '✨ 创建条目' : '💾 保存更改'}</button>
                    <button id="cancel-edit">❌ 取消</button>
                </div>
            </div>
        </div>
    `;

    $('body').append(modalHtml);
    $('#edit-entry-modal').data({apiInfo, presetName, entry, insertPosition, autoEnable, side, displayMode});
    applyEditModalStyles(isMobile, isSmallScreen, isPortrait);
    bindEditModalEvents(apiInfo, presetName, entry, insertPosition, autoEnable, side, displayMode);
}

function applyEditModalStyles(isMobile, isSmallScreen, isPortrait) {
    const isDark = isDarkTheme();
    const bgColor = isDark ? '#1a1a1a' : '#ffffff';
    const textColor = isDark ? '#e0e0e0' : '#374151';
    const borderColor = isDark ? '#374151' : '#e5e7eb';
    const inputBg = isDark ? '#222222' : '#ffffff';
    const inputBorder = isDark ? '#4b5563' : '#d1d5db';

    const styles = `
        #edit-entry-modal {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
            z-index: 10001; display: flex; align-items: ${isMobile ? 'flex-start' : 'center'};
            justify-content: center; padding: ${isMobile ? '10px' : '20px'};
            ${isMobile ? 'padding-top: 20px;' : ''}
            overflow-y: auto; -webkit-overflow-scrolling: touch; animation: pt-fadeIn 0.3s ease-out;
        }
        #edit-entry-modal .edit-modal-content {
            background: ${bgColor}; border-radius: ${isMobile ? '16px' : '20px'};
            padding: ${isSmallScreen ? '24px' : isMobile ? '28px' : '32px'};
            max-width: ${isSmallScreen ? '95vw' : isMobile ? '90vw' : '600px'};
            width: ${isSmallScreen ? '95vw' : isMobile ? '90vw' : '90%'};
            max-height: ${isMobile ? '90vh' : '85vh'};
            overflow-y: auto; color: ${textColor}; box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            ${isMobile ? '-webkit-overflow-scrolling: touch;' : ''}
            animation: pt-slideUp 0.3s ease-out;
            transition: background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease;
        }
        #edit-entry-modal .edit-modal-header {
            text-align: center; margin-bottom: ${isMobile ? '24px' : '28px'};
            padding-bottom: ${isMobile ? '18px' : '22px'}; border-bottom: 1px solid ${borderColor};
        }
        #edit-entry-modal .edit-modal-header > div:first-child {
            display: flex; align-items: center; justify-content: center;
            gap: 12px; padding: ${isMobile ? '8px 0' : '12px 0'};
        }
        #edit-entry-modal .edit-modal-header span { font-size: ${isSmallScreen ? '28px' : isMobile ? '32px' : '36px'}; }
        #edit-entry-modal .edit-modal-header h2 {
            margin: 0; font-size: ${isSmallScreen ? '22px' : isMobile ? '24px' : '28px'};
            font-weight: 700; color: ${isDark ? '#f3f4f6' : '#111827'}; letter-spacing: -0.5px;
        }
        #edit-entry-modal .preset-info {
            margin-top: 8px; font-size: ${isMobile ? '14px' : '13px'};
            color: ${isDark ? '#9ca3af' : '#6b7280'}; font-weight: 500;
        }
        #edit-entry-modal .edit-form {
            display: flex; flex-direction: column; gap: ${isMobile ? '20px' : '18px'};
        }
        #edit-entry-modal .form-field {
            display: flex; flex-direction: column;
        }
        #edit-entry-modal .form-field label {
            margin-bottom: 8px; font-weight: 600; font-size: ${isMobile ? '16px' : '15px'};
            color: ${textColor}; display: flex; align-items: center; gap: 8px;
        }
        #edit-entry-modal .form-field input, #edit-entry-modal .form-field select, #edit-entry-modal .form-field textarea {
            padding: ${isMobile ? '14px 16px' : '12px 14px'};
            background: ${inputBg}; color: ${textColor}; border: 1px solid ${inputBorder};
            border-radius: 8px; font-size: ${isMobile ? '15px' : '14px'}; font-weight: 400;
            transition: all 0.3s ease; box-sizing: border-box;
        }
        #edit-entry-modal .form-field select {
            appearance: none; background-image: url('data:image/svg+xml;charset=US-ASCII,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 5"><path fill="${isDark ? '%23e0e0e0' : '%236b7280'}" d="M2 0L0 2h4zm0 5L0 3h4z"/></svg>');
            background-repeat: no-repeat; background-position: right 16px center;
            background-size: 12px; padding-right: 45px; cursor: pointer;
        }
        #edit-entry-modal .form-field textarea {
            resize: vertical; min-height: 120px; font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            line-height: 1.5;
        }
        #edit-entry-modal .trigger-container {
            display: flex; flex-wrap: wrap; gap: 10px; background: ${inputBg};
            padding: 10px; border-radius: 8px; border: 1px solid ${inputBorder};
        }
        #edit-entry-modal .trigger-label {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            border-radius: 6px;
            cursor: pointer;
            transition: background-color 0.2s ease;
            background-color: ${isDark ? '#374151' : '#f3f4f6'};
        }
        #edit-entry-modal .trigger-label:hover {
            background-color: ${isDark ? '#4b5563' : '#e5e7eb'};
        }
        #edit-entry-modal .trigger-label input[type="checkbox"] {
            display: none;
        }
        #edit-entry-modal .trigger-label span {
            position: relative;
            padding-left: 25px;
            font-size: 14px;
            color: ${textColor};
        }
        #edit-entry-modal .trigger-label span::before {
            content: '';
            position: absolute;
            left: 0;
            top: 50%;
            transform: translateY(-50%);
            width: 18px;
            height: 18px;
            border: 2px solid ${isDark ? '#6b7280' : '#d1d5db'};
            border-radius: 4px;
            background-color: ${inputBg};
            transition: all 0.2s ease;
        }
        #edit-entry-modal .trigger-label input[type="checkbox"]:checked + span::before {
            background-color: #3b82f6;
            border-color: #3b82f6;
        }
        #edit-entry-modal .trigger-label input[type="checkbox"]:checked + span::after {
            content: '';
            position: absolute;
            left: 6px;
            top: 50%;
            width: 6px;
            height: 10px;
            border: solid white;
            border-width: 0 2px 2px 0;
            transform: translateY(-50%) rotate(45%);
        }
        #edit-entry-modal .edit-modal-actions {
            display: flex; justify-content: center; gap: ${isMobile ? '12px' : '16px'};
            margin-top: ${isMobile ? '24px' : '28px'};
            padding-top: ${isMobile ? '20px' : '24px'}; border-top: 1px solid #e5e7eb;
        }
        #edit-entry-modal .edit-modal-actions button {
            padding: ${isMobile ? '14px 24px' : '12px 22px'}; border: none; color: #ffffff;
            border-radius: 8px; cursor: pointer; font-size: ${isMobile ? '15px' : '14px'};
            font-weight: 600; transition: all 0.3s ease; letter-spacing: 0.3px;
        }
        #edit-entry-modal #save-entry-changes { background: #059669; min-width: 140px; }
        #edit-entry-modal #cancel-edit { background: #9ca3af; min-width: 100px; }
    `;

    if (!$('#edit-entry-modal-styles').length) {
        $('head').append(`<style id="edit-entry-modal-styles">${styles}</style>`);
    }
}

function bindEditModalEvents(apiInfo, presetName, originalEntry, insertPosition = null, autoEnable = false, side = null, displayMode = 'default') {
    const $ = getJQuery();
    const modal = $('#edit-entry-modal');
    const isNewEntry = originalEntry.isNewEntry || false;

    // 位置选择变化时显示/隐藏深度字段
    $('#edit-entry-position').on('change', function() {
        const position = $(this).val();
        const depthField = $('#depth-field');
        if (position === 'relative') {
            depthField.hide();
        } else {
            depthField.show();
        }
    });

    $('#save-entry-changes').on('click', async () => {
        try {
            const positionValue = $('#edit-entry-position').val(); // string 'relative' or '1'

            const updatedEntry = {
                ...originalEntry,
                name: $('#edit-entry-name').val().trim(),
                role: $('#edit-entry-role').val(),
                content: $('#edit-entry-content').val(),
                injection_order: parseInt($('#edit-entry-order').val(), 10) || 100,
                injection_trigger: $('#edit-entry-triggers .trigger-checkbox:checked').map(function() { return $(this).val(); }).get(),
            };

            if (positionValue === 'relative') {
                updatedEntry.injection_position = null; // Tavern expects null/undefined for relative
                updatedEntry.injection_depth = 4; // Default depth for relative
            } else {
                // For 'in-chat', position should be the number 1
                updatedEntry.injection_position = 1;
                const depthValue = parseInt($('#edit-entry-depth').val(), 10);
                updatedEntry.injection_depth = isNaN(depthValue) ? 4 : depthValue;
            }

            if (!updatedEntry.name) {
                alert('请输入条目名称');
                return;
            }

            const buttonText = isNewEntry ? '创建中...' : '保存中...';
            $('#save-entry-changes').prop('disabled', true).text(buttonText);

            if (isNewEntry) {
                // 新建条目，使用指定的插入位置
                const actualInsertPosition = insertPosition || 'bottom';
                await performInsertNewEntry(apiInfo, presetName, updatedEntry, actualInsertPosition, autoEnable, displayMode);
                let successMessage = `成功创建新条目 "${updatedEntry.name}"！`;
                alert(successMessage);

                if ($('#auto-close-modal').prop('checked')) {
                    $('#preset-transfer-modal').remove();
                }
            } else {
                // 编辑现有条目
                await saveEntryChanges(apiInfo, presetName, originalEntry, updatedEntry);
                alert('条目已成功更新！');
            }

            modal.remove();

            // 刷新主界面的条目列表
            if ($('#preset-transfer-modal').length) {
                if (side) {
                    // 双侧模式
                    loadAndDisplayEntries(apiInfo);
                } else {
                    // 原有模式（如果还在使用）
                    loadAndDisplayEntries(apiInfo);
                }
            }

        } catch (error) {
            console.error(isNewEntry ? '创建条目失败:' : '保存条目失败:', error);
            alert((isNewEntry ? '创建失败: ' : '保存失败: ') + error.message);
            const originalText = isNewEntry ? '✨ 创建条目' : '💾 保存更改';
            $('#save-entry-changes').prop('disabled', false).text(originalText);
        }
    });

    // 数据清理函数
    function clearEditFormData() {
        // 清空所有输入框的数据
        $('#edit-entry-name').val('');
        $('#edit-entry-role').val('system');
        $('#edit-entry-content').val('');
        $('#edit-entry-position').val('relative');
        $('#edit-entry-depth').val('4');

        // 清除任何可能的临时存储
        if (window.editEntryTempData) {
            delete window.editEntryTempData;
        }

        console.log('编辑表单数据已清理');
    }

    $('#cancel-edit').on('click', () => {
        clearEditFormData();
        modal.remove();
    });

    // 移除点击背景关闭功能，避免误触
    // modal.on('click', e => {
    //     if (e.target === modal[0]) {
    //         clearEditFormData();
    //         modal.remove();
    //     }
    // });

    // 移除ESC键关闭功能，避免误触
    // $(document).on('keydown.edit-entry', e => {
    //     if (e.key === 'Escape') {
    //         clearEditFormData();
    //         modal.remove();
    //         $(document).off('keydown.edit-entry');
    //     }
    // });

    // 添加提示信息，告知用户只能通过取消按钮关闭
    console.log('编辑/新建界面已打开，只能通过点击"取消"按钮关闭，避免误触');

    // 移动端处理
    if (getDeviceInfo().isMobile) {
        const originalOverflow = $('body').css('overflow');
        $('body').css('overflow', 'hidden');
        modal.on('remove', () => $('body').css('overflow', originalOverflow));
    }

    modal.css('display', 'flex');
}

async function saveEntryChanges(apiInfo, presetName, originalEntry, updatedEntry) {
    try {
        const presetData = getPresetDataFromManager(apiInfo, presetName);
        if (!presetData) throw new Error('无法获取预设数据');

        if (!presetData.prompts) presetData.prompts = [];

        // 查找要更新的条目
        const entryIndex = presetData.prompts.findIndex(p =>
            p.name === originalEntry.name ||
            (p.identifier && p.identifier === originalEntry.identifier)
        );

        if (entryIndex === -1) {
            throw new Error(`未找到条目 "${originalEntry.name}"`);
        }

        // 检查新名称是否与其他条目冲突（除了当前条目）
        const nameConflict = presetData.prompts.find((p, index) =>
            index !== entryIndex && p.name === updatedEntry.name
        );

        if (nameConflict) {
            throw new Error(`条目名称 "${updatedEntry.name}" 已存在`);
        }

        // 更新条目
        const existingPrompt = presetData.prompts[entryIndex];
        presetData.prompts[entryIndex] = {
            ...existingPrompt,
            name: updatedEntry.name,
            role: updatedEntry.role,
            content: updatedEntry.content,
            injection_depth: updatedEntry.injection_depth,
            injection_position: updatedEntry.injection_position,
            injection_order: updatedEntry.injection_order,
            injection_trigger: updatedEntry.injection_trigger,
        };

        // 保存预设
        await apiInfo.presetManager.savePreset(presetName, presetData);
        console.log(`条目 "${originalEntry.name}" 已更新为 "${updatedEntry.name}"`);

    } catch (error) {
        console.error('保存条目更改失败:', error);
        throw error;
    }
}

async function switchToPreset(apiInfo, presetName) {
    try {
        console.log(`切换到预设: ${presetName}`);
        const presetValue = apiInfo.presetManager.findPreset(presetName);
        if (!presetValue) throw new Error(`无法找到预设: ${presetName}`);
        apiInfo.presetManager.selectPreset(presetValue);
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log(`成功切换到预设: ${presetName}`);
    } catch (error) {
        console.error('切换预设失败:', error);
        throw error;
    }
}

async function performInsertNewEntry(apiInfo, targetPreset, newEntry, insertPosition, autoEnable, displayMode = 'default') {
    const targetData = getPresetDataFromManager(apiInfo, targetPreset);
    if (!targetData) throw new Error('无法获取目标预设数据');

    if (!targetData.prompts) targetData.prompts = [];
    const characterPromptOrder = getOrCreateDummyCharacterPromptOrder(targetData);

    // The newEntry object from the modal already has all the correct fields.
    // We just need to assign a new identifier and clean up the temporary flag.
    const newPrompt = {
        ...newEntry,
        identifier: generateUUID(),
    };
    delete newPrompt.isNewEntry;

    targetData.prompts.push(newPrompt);
    const newOrderEntry = { identifier: newPrompt.identifier, enabled: autoEnable };

    if (insertPosition === 'top') {
        characterPromptOrder.order.unshift(newOrderEntry);
    } else if (insertPosition.startsWith('after-')) {
        const afterIndex = parseInt(insertPosition.replace('after-', ''));
        const referencePromptList = getTargetPromptsList(targetPreset, displayMode);
        if (afterIndex >= 0 && afterIndex < referencePromptList.length) {
            const targetPrompt = referencePromptList[afterIndex];
            const orderIndex = characterPromptOrder.order.findIndex(e => e.identifier === targetPrompt.identifier);
            if (orderIndex !== -1) {
                characterPromptOrder.order.splice(orderIndex + 1, 0, newOrderEntry);
            } else {
                characterPromptOrder.order.push(newOrderEntry);
            }
        } else {
            characterPromptOrder.order.push(newOrderEntry);
        }
    } else {
        characterPromptOrder.order.push(newOrderEntry);
    }

    await apiInfo.presetManager.savePreset(targetPreset, targetData);
    console.log(`新条目 "${newEntry.name}" 已成功插入到预设 "${targetPreset}"`);
}

async function performTransfer(apiInfo, sourcePreset, targetPreset, selectedEntries, insertPosition, autoEnable, displayMode = 'default') {
    const sourceData = getPresetDataFromManager(apiInfo, sourcePreset);
    const targetData = getPresetDataFromManager(apiInfo, targetPreset);
    if (!sourceData || !targetData) throw new Error('无法获取预设数据');

    if (!targetData.prompts) targetData.prompts = [];
    const characterPromptOrder = getOrCreateDummyCharacterPromptOrder(targetData);

    const targetPromptMap = new Map(targetData.prompts.map((p, i) => [p.name, i]));
    const newOrderEntries = []; // 收集新的order条目

    const entriesToTransfer = batchTransferWithNewFields(selectedEntries);

    entriesToTransfer.forEach(entry => {
        if (targetPromptMap.has(entry.name)) {
            const existingIndex = targetPromptMap.get(entry.name);
            const existingPrompt = targetData.prompts[existingIndex];
            targetData.prompts[existingIndex] = { ...existingPrompt, ...entry };
            const existingOrderEntry = characterPromptOrder.order.find(o => o.identifier === existingPrompt.identifier);
            if (existingOrderEntry) {
                existingOrderEntry.enabled = autoEnable;
            } else {
                characterPromptOrder.order.push({ identifier: existingPrompt.identifier, enabled: autoEnable });
            }
        } else {
            const newPrompt = { ...entry, identifier: generateUUID() };
            targetData.prompts.push(newPrompt);
            const newOrderEntry = { identifier: newPrompt.identifier, enabled: autoEnable };
            newOrderEntries.push(newOrderEntry);
        }
    });

    // 批量插入新条目，保持原始顺序
    if (newOrderEntries.length > 0) {
        if (insertPosition === 'top') {
            // 插入到顶部，保持原始顺序
            characterPromptOrder.order.unshift(...newOrderEntries);
        } else if (insertPosition.startsWith('after-')) {
            const afterIndex = parseInt(insertPosition.replace('after-', ''));
            const referencePromptList = getTargetPromptsList(targetPreset, displayMode);
            if (afterIndex >= 0 && afterIndex < referencePromptList.length) {
                const targetPrompt = referencePromptList[afterIndex];
                const orderIndex = characterPromptOrder.order.findIndex(e => e.identifier === targetPrompt.identifier);
                if (orderIndex !== -1) {
                    characterPromptOrder.order.splice(orderIndex + 1, 0, ...newOrderEntries);
                } else {
                    characterPromptOrder.order.push(...newOrderEntries);
                }
            } else {
                characterPromptOrder.order.push(...newOrderEntries);
            }
        } else {
            characterPromptOrder.order.push(...newOrderEntries);
        }
    }
    await apiInfo.presetManager.savePreset(targetPreset, targetData);
    console.log('预设转移完成，新提示词已正确添加并启用');
}

async function performDelete(apiInfo, sourcePreset, selectedEntries) {
    const sourceData = getPresetDataFromManager(apiInfo, sourcePreset);
    if (!sourceData) throw new Error('无法获取源预设数据');
    if (!sourceData.prompts) sourceData.prompts = [];
    if (!sourceData.prompt_order) sourceData.prompt_order = [];

    const dummyCharacterId = 100001;
    let characterPromptOrder = sourceData.prompt_order.find(order => order.character_id === dummyCharacterId);
    if (!characterPromptOrder) {
        characterPromptOrder = { character_id: dummyCharacterId, order: [] };
        sourceData.prompt_order.push(characterPromptOrder);
    }

    const entriesToDelete = new Set(selectedEntries.map(entry => entry.name));
    sourceData.prompts = sourceData.prompts.filter(p => !(p && p.name && entriesToDelete.has(p.name)));
    characterPromptOrder.order = characterPromptOrder.order.filter(o => {
        if (o && o.identifier) {
            const matchingPrompt = selectedEntries.find(entry => o.identifier === entry.identifier || (entry.name && o.identifier.includes(entry.name)));
            return !matchingPrompt;
        }
        return true;
    });
    await apiInfo.presetManager.savePreset(sourcePreset, sourceData);
    console.log(`预设删除完成，已删除 ${selectedEntries.length} 个条目`);
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function initPresetTransferIntegration() {
    try {
        const $ = getJQuery();
        console.log('开始集成预设转移工具...');

        if ($('#preset-transfer-menu-item').length > 0) {
            console.log('预设转移菜单项已存在，跳过创建');
            return;
        }

        const extensionsMenu = $('#extensionsMenu');
        console.log('扩展菜单元素:', extensionsMenu.length);

        if (extensionsMenu.length === 0) {
            console.error('未找到扩展菜单');
            return;
        }

        const menuItem = $(`
            <a id="preset-transfer-menu-item" class="list-group-item" href="#" title="预设转移">
                <i class="fa-solid fa-exchange-alt"></i> 预设转移
            </a>
        `);

        extensionsMenu.append(menuItem);
        console.log('预设转移菜单项已添加');

        menuItem.on('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            // 关闭扩展菜单
            $('#extensionsMenu').fadeOut(200);
            try {
                createTransferUI();
            } catch (error) {
                console.error('创建UI失败:', error);
                alert('创建UI失败: ' + error.message);
            }
        });

        if (!$('#preset-transfer-global-styles').length) {
            $('head').append(`
                <style id="preset-transfer-global-styles">
                    @keyframes pt-fadeIn {
                        from { opacity: 0; }
                        to { opacity: 1; }
                    }
                    @keyframes pt-slideUp {
                        from { opacity: 0; transform: translateY(20px) scale(0.95); }
                        to { opacity: 1; transform: translateY(0) scale(1); }
                    }
                    @keyframes pt-pulse {
                        0%, 100% { transform: scale(1); }
                        50% { transform: scale(1.05); }
                    }
                    @keyframes pt-shake {
                        0%, 100% { transform: translateX(0); }
                        25% { transform: translateX(-5px); }
                        75% { transform: translateX(5px); }
                    }

                    /* 滚动条样式 - 使用CSS变量，由主题动态设置 */
                    #preset-transfer-modal .entries-list::-webkit-scrollbar { width: 8px; }
                    #preset-transfer-modal .entries-list::-webkit-scrollbar-track {
                        background: var(--pt-scrollbar-track-color, #f3f4f6); border-radius: 4px;
                    }
                    #preset-transfer-modal .entries-list::-webkit-scrollbar-thumb {
                        background: var(--pt-scrollbar-thumb-color, #d1d5db); border-radius: 4px;
                        transition: background 0.3s ease;
                    }
                    #preset-transfer-modal .entries-list::-webkit-scrollbar-thumb:hover {
                        background: var(--pt-scrollbar-thumb-hover-color, #9ca3af);
                    }

                    /* 条目悬停效果 */
                    #preset-transfer-modal .entry-item {
                        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
                    }
                    #preset-transfer-modal .entry-item:hover {
                        border-color: var(--pt-entry-hover-border, #9ca3af) !important;
                        box-shadow: 0 4px 12px var(--pt-entry-hover-shadow, rgba(0,0,0,0.1)) !important;
                        transform: translateY(-2px) !important;
                    }
                    #preset-transfer-modal .entry-item:active {
                        transform: translateY(0) !important;
                        box-shadow: 0 2px 6px var(--pt-entry-active-shadow, rgba(0,0,0,0.05)) !important;
                    }

                    /* 按钮通用样式 */
                    #preset-transfer-modal button {
                        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
                        border-radius: 8px !important;
                    }
                    #preset-transfer-modal button:not(.theme-toggle-btn):not(.jump-btn):not(:disabled):hover {
                        transform: translateY(-1px) !important;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
                    }
                    #preset-transfer-modal button:not(.theme-toggle-btn):not(:disabled):active {
                        transform: translateY(0) !important;
                        box-shadow: 0 2px 6px rgba(0,0,0,0.1) !important;
                    }
                    #preset-transfer-modal button:disabled {
                        opacity: 0.5 !important;
                        cursor: not-allowed !important;
                        transform: none !important;
                    }

                    /* 输入框焦点效果 */
                    #preset-transfer-modal input:focus,
                    #preset-transfer-modal select:focus,
                    #preset-transfer-modal textarea:focus {
                        border-color: var(--pt-input-focus-border, #6b7280) !important;
                        box-shadow: 0 0 0 3px var(--pt-input-focus-shadow, rgba(107, 114, 128, 0.1)) !important;
                        outline: none !important;
                        transform: scale(1.02) !important;
                        transition: all 0.3s ease !important;
                    }

                    /* 编辑模态框样式 */
                    #edit-entry-modal input:focus,
                    #edit-entry-modal select:focus,
                    #edit-entry-modal textarea:focus {
                        border-color: #059669 !important;
                        box-shadow: 0 0 0 3px rgba(5, 150, 105, 0.1) !important;
                        outline: none !important;
                        transform: scale(1.02) !important;
                    }
                    #edit-entry-modal button:not(:disabled):hover {
                        transform: translateY(-1px) !important;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
                    }
                    #edit-entry-modal button:disabled {
                        opacity: 0.5 !important;
                        cursor: not-allowed !important;
                    }

                    /* 编辑按钮特殊效果 */
                    .entry-edit-btn {
                        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
                    }
                    .entry-edit-btn:hover {
                        opacity: 0.9 !important;
                        transform: scale(1.05) translateY(-1px) !important;
                        box-shadow: 0 4px 8px rgba(5, 150, 105, 0.3) !important;
                    }
                    .entry-edit-btn:active {
                        transform: scale(0.98) !important;
                    }

                    /* 移动端触摸优化 */
                    @media (max-width: 768px) {
                        #preset-transfer-modal button {
                            min-height: 44px !important;
                        }
                        #preset-transfer-modal .entry-item {
                            min-height: 44px !important;
                        }
                        #preset-transfer-modal input,
                        #preset-transfer-modal select {
                            min-height: 44px !important;
                        }
                    }

                    /* 加载动画 */
                    .loading-pulse {
                        animation: pt-pulse 1.5s ease-in-out infinite;
                    }

                    /* 错误动画 */
                    .error-shake {
                        animation: pt-shake 0.5s ease-in-out;
                    }
                </style>
            `);
        }
        console.log('预设转移工具已集成到菜单！');
    } catch (error) {
        console.error('预设转移工具集成失败:', error);
    }
}

try {
    function waitForExtensionsMenu() {
        try {
            const $ = getJQuery();
            console.log('检查扩展菜单...', $ ? 'jQuery已加载' : 'jQuery未加载', $('#extensionsMenu').length ? '扩展菜单已找到' : '扩展菜单未找到');

            if ($ && $.fn && $('#extensionsMenu').length) {
                console.log('开始初始化预设转移工具...');
                setTimeout(initPresetTransferIntegration, 1000);
            } else {
                setTimeout(waitForExtensionsMenu, 500);
            }
        } catch (error) {
            console.warn('jQuery或扩展菜单未就绪，等待中...', error);
            setTimeout(waitForExtensionsMenu, 500);
        }
    }
    waitForExtensionsMenu();
} catch (error) {
    console.error('初始化失败:', error);
    setTimeout(initPresetTransferIntegration, 3000);
}
