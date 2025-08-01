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

function getDeviceInfo() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                     window.innerWidth <= 768 || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    const isSmallScreen = window.innerWidth <= 480;
    const isPortrait = window.innerHeight > window.innerWidth;
    return { isMobile, isSmallScreen, isPortrait };
}

function createTransferUI() {
    const apiInfo = getCurrentApiInfo();
    if (!apiInfo) {
        alert('无法获取当前API信息，请确保SillyTavern已正确加载');
        return;
    }
    if (apiInfo.presetNames.length < 2) {
        alert('至少需要2个预设才能进行转移操作');
        return;
    }

    const $ = getJQuery();
    const { isMobile, isSmallScreen, isPortrait } = getDeviceInfo();

    const modalHtml = `
        <div id="preset-transfer-modal">
            <div class="transfer-modal-content">
                <div class="modal-header">
                    <div>
                        <span>🔄</span>
                        <h2>预设条目转移工具</h2>
                    </div>
                </div>
                <div class="preset-selection">
                    <div class="preset-field">
                        <label>
                            <span><span>📤</span> 源预设</span>
                            <span>要操作的预设</span>
                        </label>
                        <select id="source-preset">
                            <option value="">请选择源预设</option>
                            ${apiInfo.presetNames.map(name => `<option value="${name}">${name}</option>`).join('')}
                        </select>
                    </div>
                    <div class="preset-field">
                        <label>
                            <span><span>📥</span> 目标预设</span>
                            <span>转移到预设</span>
                        </label>
                        <select id="target-preset">
                            <option value="">请选择目标预设</option>
                            ${apiInfo.presetNames.map(name => `<option value="${name}">${name}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="action-section">
                    <button id="load-entries" disabled>📋 加载条目</button>
                    <label class="auto-switch-label">
                        <input type="checkbox" id="auto-switch-preset" checked>
                        <span>转移后自动切换</span>
                    </label>
                    <label class="auto-switch-label">
                        <input type="checkbox" id="auto-close-modal" checked>
                        <span>完成后自动关闭</span>
                    </label>
                </div>
                <div id="entries-container" style="display: none;">
                    <div class="entries-header">
                        <h4>📝 选择要操作的条目</h4>
                        <p>💡 提示：只选源预设可删除条目，选择源+目标预设可转移条目，只选目标预设可插入空白条目</p>
                        <div class="search-section">
                            <input type="text" id="entry-search" placeholder="🔍 搜索条目...">
                        </div>
                        <div class="selection-controls">
                            <button id="select-all" class="selection-btn">✅ 全选</button>
                            <button id="select-none" class="selection-btn">❌ 全不选</button>
                            <button id="select-new" class="selection-btn">⭐ 选择新增</button>
                            <span id="selection-count"></span>
                        </div>
                    </div>
                    <div id="entries-list" class="entries-list"></div>
                    <div id="insert-position-section" style="display: none;">
                        <label>
                            <span>📍</span>
                            选择插入位置
                        </label>
                        <p>💡 请选择新条目在目标预设中的插入位置</p>
                        <select id="insert-position">
                            <option value="" disabled selected>请选择插入位置...</option>
                            <option value="top">插入到顶部</option>
                            <option value="bottom">插入到底部</option>
                        </select>
                    </div>
                    <div class="modal-actions">
                        <button id="execute-transfer" disabled>🚀 开始转移</button>
                        <button id="execute-delete" disabled>🗑️ 批量删除</button>
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
    const styles = `
        #preset-transfer-modal {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
            z-index: 10000; display: flex; align-items: ${isMobile ? 'flex-start' : 'center'};
            justify-content: center; padding: ${isMobile ? '10px' : '20px'};
            ${isMobile ? 'padding-top: 20px;' : ''}
            overflow-y: auto; -webkit-overflow-scrolling: touch; animation: fadeIn 0.3s ease-out;
        }
        #preset-transfer-modal .transfer-modal-content {
            background: #ffffff; border-radius: ${isMobile ? '16px' : '20px'};
            padding: ${isSmallScreen ? '24px' : isMobile ? '28px' : '32px'};
            max-width: ${isSmallScreen ? '95vw' : isMobile ? '90vw' : '1000px'};
            width: ${isSmallScreen ? '95vw' : isMobile ? '90vw' : '90%'};
            min-height: ${isMobile ? 'auto' : '400px'}; max-height: ${isMobile ? '90vh' : '85vh'};
            overflow-y: auto; color: #374151; box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            ${isMobile ? '-webkit-overflow-scrolling: touch;' : ''}
            animation: slideUp 0.3s ease-out;
        }
        #preset-transfer-modal .modal-header {
            text-align: center; margin-bottom: ${isMobile ? '24px' : '28px'};
            padding-bottom: ${isMobile ? '18px' : '22px'}; border-bottom: 1px solid #e5e7eb; position: relative;
        }
        #preset-transfer-modal .modal-header > div {
            display: flex; align-items: center; justify-content: center;
            gap: 12px; padding: ${isMobile ? '8px 0' : '12px 0'};
        }
        #preset-transfer-modal .modal-header span { font-size: ${isSmallScreen ? '28px' : isMobile ? '32px' : '36px'}; }
        #preset-transfer-modal .modal-header h2 {
            margin: 0; font-size: ${isSmallScreen ? '22px' : isMobile ? '24px' : '28px'};
            font-weight: 700; color: #111827; letter-spacing: -0.5px;
        }
        #preset-transfer-modal .preset-selection {
            display: ${isMobile && isPortrait ? 'flex' : 'grid'};
            ${isMobile && isPortrait ? 'flex-direction: column;' : 'grid-template-columns: 1fr 1fr;'}
            gap: ${isMobile ? '18px' : '22px'}; margin-bottom: ${isMobile ? '24px' : '28px'};
        }
        #preset-transfer-modal .preset-field {
            padding: ${isMobile ? '20px' : '24px'}; background: #f9fafb;
            border-radius: 12px; border: 1px solid #e5e7eb; transition: all 0.3s ease;
        }
        #preset-transfer-modal .preset-field label {
            display: flex; flex-direction: column; justify-content: flex-start;
            margin-bottom: 14px; font-weight: 600; font-size: ${isMobile ? '16px' : '15px'};
            color: #374151; min-height: 50px;
        }
        #preset-transfer-modal .preset-field label span:first-child { display: flex; align-items: center; gap: 10px; }
        #preset-transfer-modal .preset-field label span:first-child span {
            display: inline-flex; align-items: center; justify-content: center;
            width: 24px; height: 24px; background: #ffffff; border: 1px solid #e5e7eb;
            border-radius: 6px; color: #374151; font-size: 12px;
        }
        #preset-transfer-modal .preset-field label span:last-child {
            color: #6b7280; font-weight: 400; font-size: ${isMobile ? '13px' : '12px'}; margin-top: 4px;
        }
        #preset-transfer-modal select {
            width: 100%; padding: ${isMobile ? '14px 16px' : '12px 14px'};
            background: #ffffff; color: #374151; border: 1px solid #d1d5db;
            border-radius: 8px; font-size: ${isMobile ? '15px' : '14px'}; font-weight: 500;
            appearance: none; background-image: url('data:image/svg+xml;charset=US-ASCII,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 5"><path fill="%236b7280" d="M2 0L0 2h4zm0 5L0 3h4z"/></svg>');
            background-repeat: no-repeat; background-position: right 16px center;
            background-size: 12px; padding-right: 45px; box-sizing: border-box;
            transition: all 0.3s ease; cursor: pointer;
        }
        #preset-transfer-modal .action-section {
            display: flex; flex-wrap: wrap; align-items: center;
            gap: ${isMobile ? '16px' : '20px'}; margin-bottom: ${isMobile ? '20px' : '25px'};
            ${isMobile ? 'justify-content: center;' : ''}
        }
        #preset-transfer-modal #load-entries {
            padding: ${isMobile ? '16px 28px' : '14px 26px'}; background: #374151;
            border: none; color: #ffffff; border-radius: 8px; cursor: pointer;
            font-size: ${isMobile ? '16px' : '15px'}; font-weight: 600;
            ${isMobile ? 'width: 100%;' : 'min-width: 150px;'}
            transition: all 0.3s ease; text-transform: uppercase; letter-spacing: 0.5px;
        }
        #preset-transfer-modal .auto-switch-label {
            display: flex; align-items: center; gap: 12px; color: #374151;
            font-size: ${isMobile ? '15px' : '14px'}; font-weight: 500;
            cursor: pointer; user-select: none; ${isMobile ? 'justify-content: center;' : ''}
        }
        #preset-transfer-modal .auto-switch-label input {
            ${isMobile ? 'transform: scale(1.4);' : 'transform: scale(1.2);'}
            accent-color: #374151; cursor: pointer;
        }
        #preset-transfer-modal #entries-container { width: 100%; }
        #preset-transfer-modal .entries-header {
            margin-bottom: ${isMobile ? '20px' : '25px'}; padding: ${isMobile ? '18px' : '22px'};
            background: #f9fafb; border-radius: 12px; border: 1px solid #e5e7eb;
        }
        #preset-transfer-modal .entries-header h4 {
            color: #374151; margin: 0 0 16px 0; font-size: ${isMobile ? '18px' : '17px'};
            font-weight: 700; letter-spacing: -0.3px;
        }
        #preset-transfer-modal .entries-header p {
            margin: 0 0 14px 0; font-size: ${isMobile ? '14px' : '13px'};
            color: #6b7280; line-height: 1.5;
        }
        #preset-transfer-modal .search-section { margin-bottom: 16px; }
        #preset-transfer-modal #entry-search {
            width: 100%; padding: ${isMobile ? '14px 18px' : '12px 16px'};
            background: #ffffff; color: #374151; border: 1px solid #d1d5db;
            border-radius: 8px; font-size: ${isMobile ? '15px' : '14px'}; font-weight: 400;
            transition: all 0.3s ease; box-sizing: border-box;
        }
        #preset-transfer-modal .selection-controls {
            display: ${isMobile && isPortrait ? 'grid' : 'flex'};
            ${isMobile && isPortrait ? 'grid-template-columns: 1fr 1fr; grid-gap: 10px;' : 'flex-wrap: wrap; gap: 10px;'}
            align-items: center; margin-bottom: 8px;
        }
        #preset-transfer-modal .selection-btn {
            padding: ${isMobile ? '12px 18px' : '10px 16px'}; border: none; color: #ffffff;
            border-radius: 6px; cursor: pointer; font-size: ${isMobile ? '14px' : '13px'};
            font-weight: 600; transition: all 0.3s ease;
        }
        #preset-transfer-modal #select-all { background: #6b7280; ${isMobile && isPortrait ? '' : 'min-width: 90px;'} }
        #preset-transfer-modal #select-none { background: #9ca3af; ${isMobile && isPortrait ? '' : 'min-width: 90px;'} }
        #preset-transfer-modal #select-new { background: #4b5563; ${isMobile && isPortrait ? 'grid-column: 1 / -1;' : 'min-width: 100px;'} }
        #preset-transfer-modal #selection-count {
            ${isMobile && isPortrait ? 'grid-column: 1 / -1; text-align: center; margin-top: 10px;' : 'margin-left: auto;'}
            color: #374151; font-size: ${isMobile ? '14px' : '13px'}; font-weight: 600;
            padding: 8px 14px; background: #f3f4f6; border-radius: 6px;
        }
        #preset-transfer-modal .entries-list {
            min-height: ${isSmallScreen ? '150px' : isMobile ? '200px' : '250px'};
            max-height: ${isSmallScreen ? '300px' : isMobile ? '400px' : '450px'};
            overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 12px;
            background: #f9fafb; padding: ${isMobile ? '12px' : '16px'};
            -webkit-overflow-scrolling: touch; scrollbar-width: thin; scrollbar-color: #d1d5db transparent;
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
            padding: ${isMobile ? '20px 0' : '24px 0'}; border-top: 1px solid #e5e7eb;
        }
        #preset-transfer-modal .modal-actions button {
            padding: ${isMobile ? '14px 20px' : '12px 20px'}; border: none; color: #ffffff;
            border-radius: 6px; cursor: pointer; font-size: ${isMobile ? '14px' : '14px'};
            font-weight: 600; transition: all 0.3s ease; letter-spacing: 0.3px;
        }
        #preset-transfer-modal #execute-transfer { background: #374151; ${isMobile ? '' : 'min-width: 130px;'} }
        #preset-transfer-modal #execute-delete { background: #6b7280; ${isMobile ? '' : 'min-width: 130px;'} }
        #preset-transfer-modal #close-modal { background: #9ca3af; ${isMobile ? '' : 'min-width: 90px;'} }
    `;
    if (!$('#preset-transfer-styles').length) {
        $('head').append(`<style id="preset-transfer-styles">${styles}</style>`);
    }
}

function bindTransferEvents(apiInfo, modal) {
    const $ = getJQuery();
    const sourceSelect = $('#source-preset');
    const targetSelect = $('#target-preset');
    const loadBtn = $('#load-entries');
    const executeBtn = $('#execute-transfer');

    sourceSelect.add(targetSelect).on('change', function() {
        const hasSource = sourceSelect.val();
        const hasTarget = targetSelect.val();
        // 只要有源预设或目标预设就可以加载条目
        loadBtn.prop('disabled', !hasSource && !hasTarget);
        const canTransfer = hasSource && hasTarget && hasSource !== hasTarget;
        const canInsert = !hasSource && hasTarget; // 只有目标预设时可以插入
        executeBtn.prop('disabled', !canTransfer && !canInsert);
        const canDelete = hasSource && !hasTarget; // 只有源预设时可以删除
        $('#execute-delete').prop('disabled', !canDelete);
        $('#entries-container').hide();
        $('#insert-position-section').hide();
    });

    loadBtn.on('click', () => loadAndDisplayEntries(apiInfo));
    $('#entry-search').on('input', function() { filterEntries($(this).val()); });
    $('#select-all').on('click', () => { $('#entries-list .entry-checkbox').prop('checked', true); updateSelectionCount(); updateExecuteButton(); });
    $('#select-none').on('click', () => { $('#entries-list .entry-checkbox').prop('checked', false); updateSelectionCount(); updateExecuteButton(); });
    $('#select-new').on('click', () => { $('#entries-list .entry-checkbox').prop('checked', false); $('#entries-list .entry-checkbox[data-status="new"]').prop('checked', true); updateSelectionCount(); updateExecuteButton(); });
    $('#insert-position').on('change', updateExecuteButton);
    executeBtn.on('click', () => executeTransfer(apiInfo));
    $('#execute-delete').on('click', () => executeDelete(apiInfo));
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

function loadAndDisplayEntries(apiInfo) {
    const $ = getJQuery();
    const sourcePreset = $('#source-preset').val();
    const targetPreset = $('#target-preset').val();

    // 检查是否至少选择了一个预设
    if (!sourcePreset && !targetPreset) {
        alert('请至少选择一个预设');
        return;
    }

    try {
        let transferableEntries;

        if (sourcePreset && targetPreset && targetPreset !== sourcePreset) {
            // 源+目标预设：转移模式
            const sourceData = getPresetDataFromManager(apiInfo, sourcePreset);
            const sourceEntries = getPromptEntries(sourceData);
            const targetData = getPresetDataFromManager(apiInfo, targetPreset);
            const targetEntries = getPromptEntries(targetData);
            transferableEntries = analyzeTransferableEntries(sourceEntries, targetEntries);
        } else if (sourcePreset && !targetPreset) {
            // 只有源预设：删除模式
            const sourceData = getPresetDataFromManager(apiInfo, sourcePreset);
            const sourceEntries = getPromptEntries(sourceData);
            transferableEntries = sourceEntries.map(entry => ({ ...entry, status: 'source', statusText: '源条目', statusIcon: '📄' }));
        } else if (!sourcePreset && targetPreset) {
            // 只有目标预设：插入空白条目模式
            const targetData = getPresetDataFromManager(apiInfo, targetPreset);
            const targetEntries = getPromptEntries(targetData);
            transferableEntries = targetEntries.map(entry => ({ ...entry, status: 'target', statusText: '目标条目', statusIcon: '📋' }));
            // 添加一个特殊的空白条目选项
            transferableEntries.unshift({
                name: '新建空白条目',
                content: '',
                role: 'system',
                injection_depth: 4,
                injection_position: 'relative',
                status: 'new',
                statusText: '新建',
                statusIcon: '✨',
                isNewEntry: true
            });
        } else {
            // 源预设和目标预设相同
            const sourceData = getPresetDataFromManager(apiInfo, sourcePreset);
            const sourceEntries = getPromptEntries(sourceData);
            transferableEntries = sourceEntries.map(entry => ({ ...entry, status: 'source', statusText: '源条目', statusIcon: '📄' }));
        }

        window.transferableEntries = transferableEntries;
        displayTransferableEntries(transferableEntries);

        if (targetPreset && (targetPreset !== sourcePreset || !sourcePreset)) {
            updateInsertPositionOptions(targetPreset);
            $('#insert-position-section').show();
        } else {
            $('#insert-position-section').hide();
        }
        $('#entries-container').show();
        updateExecuteButtonState();
    } catch (error) {
        console.error('加载条目失败:', error);
        alert('加载条目失败: ' + error.message);
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
    if (entries.length === 0) {
        entriesList.html(`<div style="color: #6b7280; text-align: center; padding: ${isMobile ? '40px 20px' : '50px 20px'}; font-size: ${isMobile ? '16px' : '15px'}; font-weight: 500;"><div style="font-size: 64px; margin-bottom: 20px; opacity: 0.3;">📭</div><div>没有可转移的条目</div></div>`);
        return;
    }

    const entriesHtml = entries.map((entry, index) => {
        const statusColor = entry.status === 'new' ? '#10b981' : entry.status === 'different' ? '#f59e0b' : '#6b7280';
        return `
            <div class="entry-item" data-index="${index}" style="border-color: #e5e7eb; background: #ffffff; transition: all 0.3s ease; cursor: pointer; position: relative; display: flex; align-items: ${isMobile ? 'flex-start' : 'center'}; padding: ${isSmallScreen ? '16px 14px' : isMobile ? '18px 16px' : '16px 18px'}; margin-bottom: ${isMobile ? '12px' : '10px'}; border: 1px solid #e5e7eb; border-radius: 10px; ${isMobile ? 'min-height: 70px;' : 'min-height: 56px;'}">
                <input type="checkbox" class="entry-checkbox" data-status="${entry.status}" style="margin-right: ${isMobile ? '15px' : '14px'}; ${isMobile ? 'margin-top: 6px;' : ''} width: ${isMobile ? '20px' : '18px'}; height: ${isMobile ? '20px' : '18px'}; accent-color: ${statusColor}; cursor: pointer; position: relative; z-index: 10;">
                <div style="flex: 1; ${isMobile ? 'min-width: 0;' : ''}">
                    <div class="entry-name" style="font-weight: 600; color: #111827; font-size: ${isSmallScreen ? '15px' : isMobile ? '16px' : '15px'}; margin-bottom: ${isMobile ? '6px' : '4px'}; word-break: break-word; line-height: 1.4;">${entry.name}</div>
                    <div class="entry-details" style="font-size: ${isSmallScreen ? '12px' : isMobile ? '13px' : '12px'}; color: #6b7280; line-height: 1.5; ${isMobile ? 'display: flex; flex-direction: column; gap: 3px;' : ''}">
                        <div class="status-info" style="display: inline-flex; align-items: center; gap: 6px;">
                            <span style="font-size: ${isMobile ? '15px' : '14px'};">${entry.statusIcon}</span>
                            <span style="color: ${statusColor}; font-weight: 500; padding: 3px 8px; background: ${statusColor}20; border-radius: 6px; font-size: ${isSmallScreen ? '11px' : '12px'};">${entry.statusText}</span>
                        </div>
                        ${entry.role || entry.injection_position ? `<div class="meta-info" style="display: inline-flex; ${isMobile ? 'flex-direction: column; gap: 2px;' : 'gap: 12px;'} margin-left: ${isMobile ? '0' : '8px'}; font-size: ${isSmallScreen ? '11px' : '12px'}; opacity: 0.8;">${entry.role ? `<span>👤 ${entry.role}</span>` : ''}${entry.injection_position ? `<span>📍 ${entry.injection_position}</span>` : ''}</div>` : ''}
                    </div>
                </div>
            </div>`;
    }).join('');
    entriesList.html(entriesHtml);

    setTimeout(() => {
        const parentJQuery = getParentWindow().$;
        const entriesContainer = parentJQuery('#entries-list');
        entriesContainer.off('change', '.entry-checkbox').on('change', '.entry-checkbox', () => { updateSelectionCount(); updateExecuteButton(); });
        entriesContainer.off('click', '.entry-item').on('click', '.entry-item', function(e) {
            if (!parentJQuery(e.target).is('.entry-checkbox')) {
                e.preventDefault();
                const checkbox = parentJQuery(this).find('.entry-checkbox');
                checkbox.prop('checked', !checkbox.prop('checked')).trigger('change');
            }
        });
        updateSelectionCount();
        updateExecuteButton();
    }, 50);
}

function updateInsertPositionOptions(targetPreset) {
    const $ = getJQuery();
    const insertSelect = $('#insert-position');
    insertSelect.empty().append('<option value="" disabled selected>请选择插入位置...</option><option value="top">插入到顶部</option><option value="bottom">插入到底部</option>');
    const targetOrderList = getTargetEnabledPromptsList(targetPreset);
    if (targetOrderList.length > 0) {
        insertSelect.append('<option disabled>──────────</option>');
        targetOrderList.forEach((entry, index) => insertSelect.append(`<option value="after-${index}">插入到 "${entry.name}" 之后</option>`));
    }
    insertSelect.trigger('change');
}

function getTargetEnabledPromptsList(targetPreset) {
    try {
        const apiInfo = getCurrentApiInfo();
        if (!apiInfo) return [];
        const targetData = getPresetDataFromManager(apiInfo, targetPreset);
        if (!targetData) return [];
        const dummyCharacterId = 100001;
        const characterPromptOrder = targetData.prompt_order?.find(order => order.character_id === dummyCharacterId);
        if (!characterPromptOrder) return [];
        return characterPromptOrder.order
            .filter(orderEntry => orderEntry.enabled)
            .map(orderEntry => targetData.prompts?.find(p => p.identifier === orderEntry.identifier))
            .filter(prompt => prompt && !prompt.system_prompt && !prompt.marker);
    } catch (error) {
        console.error('获取目标启用提示词列表失败:', error);
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

function updateExecuteButton() {
    const $ = getJQuery();
    const hasSelected = $('#entries-list .entry-checkbox:checked').length > 0;
    const sourcePreset = $('#source-preset').val();
    const targetPreset = $('#target-preset').val();
    const insertPosition = $('#insert-position').val();

    // 三种模式的判断
    const isTransferMode = sourcePreset && targetPreset && sourcePreset !== targetPreset;
    const isInsertMode = !sourcePreset && targetPreset;
    const isDeleteMode = sourcePreset && !targetPreset;

    // 转移模式：需要选择条目 + 插入位置
    const canTransfer = isTransferMode && hasSelected && (insertPosition && insertPosition !== '');

    // 插入模式：需要选择新建条目 + 插入位置
    const canInsert = isInsertMode && hasSelected && (insertPosition && insertPosition !== '');

    // 删除模式：需要选择条目
    const canDelete = isDeleteMode && hasSelected;

    $('#execute-transfer').prop('disabled', !(canTransfer || canInsert));
    $('#execute-delete').prop('disabled', !canDelete);
}

function updateExecuteButtonState() {
    updateExecuteButton();
}

function getSelectedEntries() {
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

async function executeTransfer(apiInfo) {
    const $ = getJQuery();
    const sourcePreset = $('#source-preset').val();
    const targetPreset = $('#target-preset').val();
    const selectedEntries = getSelectedEntries();
    const insertPosition = $('#insert-position').val();
    if (selectedEntries.length === 0) { alert('请至少选择一个条目'); return; }

    const isInsertMode = !sourcePreset && targetPreset;
    const hasNewEntry = selectedEntries.some(e => e.isNewEntry);

    if (isInsertMode && hasNewEntry) {
        // 插入空白条目模式 - 无需弹窗
        const newEntry = {
            name: '新提示词', // 使用默认名称
            content: '', // 使用空内容
            role: 'system',
            injection_depth: 4,
            injection_position: 'relative',
            forbid_overrides: false
        };

        try {
            $('#execute-transfer').prop('disabled', true).text('插入中...');
            await performInsertNewEntry(apiInfo, targetPreset, newEntry, insertPosition);
            let successMessage = `成功插入新条目 "${newEntry.name}"！`;
            if ($('#auto-switch-preset').prop('checked')) {
                try {
                    await switchToPreset(apiInfo, targetPreset);
                    successMessage += ` 并切换到预设 "${targetPreset}"！`;
                } catch (switchError) {
                    console.error('切换预设失败:', switchError);
                    successMessage += `\n但切换预设失败: ${switchError.message}`;
                }
            }
            alert(successMessage);
            if ($('#auto-close-modal').prop('checked')) {
                $('#preset-transfer-modal').remove();
            } else {
                // 刷新UI而不是关闭
                loadAndDisplayEntries(apiInfo);
                $('#execute-transfer').prop('disabled', false).text('🚀 开始转移');
            }
        } catch (error) {
            console.error('插入失败:', error);
            alert('插入失败: ' + error.message);
            $('#execute-transfer').prop('disabled', false).text('🚀 开始转移');
        }
    } else {
        // 原有的转移模式
        const conflicts = selectedEntries.filter(e => e.status === 'different');
        let message = `开始转移 ${selectedEntries.length} 个条目从 "${sourcePreset}" 到 "${targetPreset}"`;
        if (conflicts.length > 0) message += `\n其中 ${conflicts.length} 个条目将覆盖目标预设中的现有值。`;
        console.log(message);

        try {
            $('#execute-transfer').prop('disabled', true).text('转移中...');
            await performTransfer(apiInfo, sourcePreset, targetPreset, selectedEntries, insertPosition);
            let successMessage = `成功转移 ${selectedEntries.length} 个条目！`;
            if ($('#auto-switch-preset').prop('checked')) {
                try {
                    await switchToPreset(apiInfo, targetPreset);
                    successMessage += ` 并切换到预设 "${targetPreset}"！`;
                } catch (switchError) {
                    console.error('切换预设失败:', switchError);
                    successMessage += `\n但切换预设失败: ${switchError.message}`;
                }
            }
            alert(successMessage);
            if ($('#auto-close-modal').prop('checked')) {
                $('#preset-transfer-modal').remove();
            } else {
                // 刷新UI而不是关闭
                loadAndDisplayEntries(apiInfo);
                $('#execute-transfer').prop('disabled', false).text('🚀 开始转移');
            }
        } catch (error) {
            console.error('转移失败:', error);
            alert('转移失败: ' + error.message);
            $('#execute-transfer').prop('disabled', false).text('🚀 开始转移');
        }
    }
}

async function executeDelete(apiInfo) {
    const $ = getJQuery();
    const selectedEntries = getSelectedEntries();
    const sourcePreset = $('#source-preset').val();
    if (selectedEntries.length === 0) { alert('请至少选择一个条目进行删除'); return; }
    console.log(`开始从预设 "${sourcePreset}" 删除 ${selectedEntries.length} 个条目`);

    try {
        $('#execute-delete').prop('disabled', true).text('删除中...');
        await performDelete(apiInfo, sourcePreset, selectedEntries);
        alert(`成功删除 ${selectedEntries.length} 个条目！`);
        if ($('#auto-close-modal').prop('checked')) {
            $('#preset-transfer-modal').remove();
        } else {
            // 刷新UI而不是关闭
            loadAndDisplayEntries(apiInfo);
            $('#execute-delete').prop('disabled', false).text('🗑️ 批量删除');
        }
    } catch (error) {
        console.error('删除失败:', error);
        alert('删除失败: ' + error.message);
        $('#execute-delete').prop('disabled', false).text('🗑️ 批量删除');
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

async function performInsertNewEntry(apiInfo, targetPreset, newEntry, insertPosition) {
    const targetData = getPresetDataFromManager(apiInfo, targetPreset);
    if (!targetData) throw new Error('无法获取目标预设数据');

    if (!targetData.prompts) targetData.prompts = [];
    const characterPromptOrder = getOrCreateDummyCharacterPromptOrder(targetData);

    const newIdentifier = generateUUID();
    const newPrompt = {
        identifier: newIdentifier,
        name: newEntry.name,
        role: newEntry.role || 'system',
        content: newEntry.content || '',
        system_prompt: false,
        marker: false,
        injection_depth: newEntry.injection_depth || 4,
        injection_position: newEntry.injection_position || 'relative',
        forbid_overrides: newEntry.forbid_overrides || false
    };

    targetData.prompts.push(newPrompt);
    const newOrderEntry = { identifier: newIdentifier, enabled: true };

    if (insertPosition === 'top') {
        characterPromptOrder.order.unshift(newOrderEntry);
    } else if (insertPosition.startsWith('after-')) {
        const afterIndex = parseInt(insertPosition.replace('after-', ''));
        const enabledUserPrompts = getTargetEnabledPromptsList(targetPreset);
        if (afterIndex >= 0 && afterIndex < enabledUserPrompts.length) {
            const targetPrompt = enabledUserPrompts[afterIndex];
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

async function performTransfer(apiInfo, sourcePreset, targetPreset, selectedEntries, insertPosition) {
    const sourceData = getPresetDataFromManager(apiInfo, sourcePreset);
    const targetData = getPresetDataFromManager(apiInfo, targetPreset);
    if (!sourceData || !targetData) throw new Error('无法获取预设数据');

    if (!targetData.prompts) targetData.prompts = [];
    const characterPromptOrder = getOrCreateDummyCharacterPromptOrder(targetData);

    const targetPromptMap = new Map(targetData.prompts.map((p, i) => [p.name, i]));
    selectedEntries.forEach(entry => {
        if (targetPromptMap.has(entry.name)) {
            const existingIndex = targetPromptMap.get(entry.name);
            const existingPrompt = targetData.prompts[existingIndex];
            targetData.prompts[existingIndex] = { ...existingPrompt, name: entry.name, role: entry.role || 'system', content: entry.content || '', injection_depth: entry.injection_depth || 4, injection_position: entry.injection_position || 'relative', forbid_overrides: entry.forbid_overrides || false };
            const existingOrderEntry = characterPromptOrder.order.find(o => o.identifier === existingPrompt.identifier);
            if (existingOrderEntry) existingOrderEntry.enabled = true;
            else characterPromptOrder.order.push({ identifier: existingPrompt.identifier, enabled: true });
        } else {
            const newIdentifier = generateUUID();
            const newPrompt = { identifier: newIdentifier, name: entry.name, role: entry.role || 'system', content: entry.content || '', system_prompt: false, marker: false, injection_depth: entry.injection_depth || 4, injection_position: entry.injection_position || 'relative', forbid_overrides: entry.forbid_overrides || false };
            targetData.prompts.push(newPrompt);
            const newOrderEntry = { identifier: newIdentifier, enabled: true };
            if (insertPosition === 'top') characterPromptOrder.order.unshift(newOrderEntry);
            else if (insertPosition.startsWith('after-')) {
                const afterIndex = parseInt(insertPosition.replace('after-', ''));
                const enabledUserPrompts = getTargetEnabledPromptsList(targetPreset);
                if (afterIndex >= 0 && afterIndex < enabledUserPrompts.length) {
                    const targetPrompt = enabledUserPrompts[afterIndex];
                    const orderIndex = characterPromptOrder.order.findIndex(e => e.identifier === targetPrompt.identifier);
                    if (orderIndex !== -1) characterPromptOrder.order.splice(orderIndex + 1, 0, newOrderEntry);
                    else characterPromptOrder.order.push(newOrderEntry);
                } else characterPromptOrder.order.push(newOrderEntry);
            } else characterPromptOrder.order.push(newOrderEntry);
        }
    });
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
        if ($('#preset-transfer-menu-item').length > 0) return;

        const menuItem = $(`
            <a id="preset-transfer-menu-item" class="list-group-item" href="#" title="预设转移">
                <i class="fa-solid fa-right-left"></i> 预设转移
            </a>
        `);

        $('#extensionsMenu').append(menuItem);

        menuItem.on('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            // 关闭扩展菜单
            $('#extensionsMenu').fadeOut(200);
            createTransferUI();
        });

        if (!$('#preset-transfer-global-styles').length) {
            $('head').append(`
                <style id="preset-transfer-global-styles">
                    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                    @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
                    #preset-transfer-modal .entries-list::-webkit-scrollbar { width: 8px; }
                    #preset-transfer-modal .entries-list::-webkit-scrollbar-track { background: #f3f4f6; border-radius: 4px; }
                    #preset-transfer-modal .entries-list::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 4px; }
                    #preset-transfer-modal .entries-list::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
                    #preset-transfer-modal .entry-item:hover { border-color: #9ca3af !important; box-shadow: 0 2px 4px rgba(0,0,0,0.05) !important; }
                    #preset-transfer-modal #entry-search:focus, #preset-transfer-modal select:focus { border-color: #6b7280 !important; box-shadow: 0 0 0 3px rgba(107, 114, 128, 0.1) !important; outline: none !important; }
                    #preset-transfer-modal button:not(:disabled):hover { opacity: 0.9; }
                    #preset-transfer-modal button:disabled { opacity: 0.5 !important; cursor: not-allowed !important; }
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
            if ($ && $.fn && $('#extensionsMenu').length) {
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
