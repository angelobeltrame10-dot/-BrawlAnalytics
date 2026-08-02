/* ==========================================================
   BRAWL ANALYTICS
   FORMATS MANAGER
   Handles format cards, modal, and AI keyword generation
========================================================== */

import { loadCustomFormats, saveCustomFormats } from "./js_storage.js";
import { generateKeywordsForFormat } from "./js_api.js";
import { classifyVideos } from "./js_fomats.js";
import { getDashboardData } from "./js_dashboard.js";
import { getVideoTitle, getVideoViews } from "./js_csv_fields.js";
import { invalidateChannelProfileCache } from "./js_video_analysis.js";

let formatsManagerInitialized = false;

const ICON_COLORS = ['yellow', 'blue', 'green', 'purple'];

function getIconColor(index) {
    return ICON_COLORS[index % ICON_COLORS.length];
}

function formatCompactNumber(value) {
    const amount = Number(value) || 0;

    if (amount >= 1000000) {
        return `${(amount / 1000000).toFixed(amount % 1000000 === 0 ? 0 : 1)}M`;
    }

    if (amount >= 1000) {
        return `${(amount / 1000).toFixed(amount % 1000 === 0 ? 0 : 1)}K`;
    }

    return `${Math.round(amount)}`;
}

function getIconForFormat(formatName) {
    const name = formatName.toLowerCase();
    if (name.includes('trick') || name.includes('shot')) return '🎯';
    if (name.includes('funny') || name.includes('lol') || name.includes('moment')) return '😂';
    if (name.includes('challenge') || name.includes('only')) return '🏆';
    if (name.includes('ranked') || name.includes('battle')) return '⚔️';
    if (name.includes('guide') || name.includes('tutorial') || name.includes('how')) return '📚';
    if (name.includes('story') || name.includes('lore')) return '📖';
    if (name.includes('meme')) return '😈';
    return '📹';
}

async function renderFormatCards() {
    const container = document.getElementById('formats-container');
    if (!container) return;

    const formats = await loadCustomFormats();
    const videos = getDashboardData();

    // Calcolo metriche per formato: usa SEMPRE getEffectiveAssociatedVideos
    // (manuale se format.associatedVideos è presente/non vuoto, altrimenti
    // auto-classificazione via keyword) — è la STESSA funzione usata dal
    // modal "View" per decidere quali video sono spuntati.
    const sortedFormats = formats
        .map((format, index) => {
            const associatedVideos = getEffectiveAssociatedVideos(format, formats, videos);
            const titleSet = new Set(associatedVideos);
            const totalViews = videos.reduce((sum, video) => {
                return titleSet.has(getVideoTitle(video)) ? sum + getVideoViews(video) : sum;
            }, 0);

            return {
                ...format,
                videoCount: associatedVideos.length,
                totalViews,
                originalIndex: index
            };
        })
        .sort((a, b) => (b.totalViews || 0) - (a.totalViews || 0));

        if (sortedFormats.length === 0) {

        container.innerHTML = `

            <div class="format-empty">

                <div class="format-empty-icon">📂</div>

                <h3>No formats detected</h3>

                <p>
                    Upload a YouTube CSV or create your first format manually.
                </p>

            </div>

        `;

        return;

        }

    const bestPerformer = sortedFormats.length > 0 ? sortedFormats[0].name : null;

    container.innerHTML = sortedFormats.map((format, index) => {
        const isBest = format.name === bestPerformer;
        const iconColor = getIconColor(index);
        const icon = getIconForFormat(format.name);
        
        return `
            <div class="format-card ${isBest ? 'best-performer' : ''}" data-format-index="${format.originalIndex}">
                <div class="format-icon ${iconColor}">
                    ${icon}
                </div>
                <div class="format-content">
                    <div class="format-name">
                        ${format.name}
                        ${isBest ? '<span class="format-badge">Best performer</span>' : ''}
                    </div>
                    <div class="format-stats">
                        ${formatCompactNumber(format.totalViews || 0)} views · ${format.videoCount} video${format.videoCount === 1 ? '' : 's'}
                        ${format.description ? ` · ${format.description}` : ''}
                    </div>
                </div>
                <div class="format-actions">
                    <button class="format-action-btn view" data-action="view">View</button>
                    <button class="format-action-btn rename" data-action="rename">Rename</button>
                    <button class="format-action-btn delete" data-action="delete">Delete</button>
                </div>
            </div>
        `;
    }).join('');

    // Add event listeners
    container.querySelectorAll('.format-action-btn').forEach(btn => {
        btn.addEventListener('click', handleFormatAction);
    });
}

function handleFormatAction(event) {
    const action = event.target.dataset.action;
    const card = event.target.closest('.format-card');
    const formatIndex = parseInt(card.dataset.formatIndex);

    if (action === 'delete') deleteFormat(formatIndex);
    else if (action === 'rename') renameFormat(formatIndex);
    else if (action === 'view') viewFormat(formatIndex);
}

async function deleteFormat(index) {
    const format = (await loadCustomFormats())[index];
    const formatName = format?.name || "this format";

    const confirmed = window.confirm(`Delete format "${formatName}"?`);
    if (!confirmed) return;

    const formats = await loadCustomFormats();
    formats.splice(index, 1);
    await saveCustomFormats(formats);
    window.dispatchEvent(new CustomEvent("brawl:formats-changed"));
    invalidateChannelProfileCache();
    await renderFormatCards();
}

async function renameFormat(index) {
    const formats = await loadCustomFormats();
    const format = formats[index];
    
    const newName = prompt('Enter new name:', format.name);
    if (!newName || newName.trim() === '') return;
    
    const newDescription = prompt('Enter new description:', format.description || '');
    
    // Titoli dei video attualmente classificati sotto QUESTO formato
    // (con le sue keyword vecchie), da usare come contesto reale per
    // l'AI invece di rigenerare le keyword indovinando da nome +
    // descrizione soltanto.
    const videos = getDashboardData();
    const classified = classifyVideos(videos, formats);
    const memberTitles = classified
        .filter(video => video.format === format.name)
        .map(video => getVideoTitle(video))
        .filter(Boolean);

    formats[index] = {
        ...format,
        name: newName.trim(),
        description: newDescription?.trim() || format.description,
        associatedVideos: format.associatedVideos || []
    };

    try {
        const channelTitles = videos.map(video => getVideoTitle(video)).filter(Boolean);
        const keywords = await generateKeywordsForFormat(newName.trim(), newDescription?.trim() || '', memberTitles, channelTitles);
        formats[index].keywords = keywords;
    } catch (error) {
        console.error('Error regenerating keywords:', error);
    }

    await saveCustomFormats(formats);
        window.dispatchEvent(new CustomEvent("brawl:formats-changed"));
    invalidateChannelProfileCache();
    await renderFormatCards();
}

function showModal() {
    const overlay = document.getElementById('format-modal-overlay');
    if (overlay) {
        overlay.classList.add('active');
    }
}

function hideModal() {
    const overlay = document.getElementById('format-modal-overlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
}

function hideFormatDetailModal() {
    const overlay = document.getElementById('format-detail-modal-overlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
}

function migrateVideoIdsToTitles(formats, allVideos) {
    // Create mapping from "Contenuti" (ID) to real title
    const idToTitleMap = {};
    allVideos.forEach(video => {
        const id = video?.["Contenuti"];
        const title = getVideoTitle(video);
        if (id && title && id !== title) {
            idToTitleMap[id] = title;
        }
    });
    
    let hasChanges = false;
    
    formats.forEach(format => {
        if (Array.isArray(format.associatedVideos)) {
            const originalVideos = [...format.associatedVideos];
            // Convert any IDs to titles
            format.associatedVideos = format.associatedVideos.map(videoId => {
                // If this looks like an ID (11 chars, typical YouTube ID format) and we have a mapping
                if (videoId.length === 11 && idToTitleMap[videoId]) {
                    return idToTitleMap[videoId];
                }
                return videoId;
            });
            
            if (JSON.stringify(originalVideos) !== JSON.stringify(format.associatedVideos)) {
                hasChanges = true;
                console.log(`Migrated format "${format.name}": converted IDs to titles`);
            }
        }
    });
    
    return hasChanges;
}

/**
 * Restituisce i video "effettivamente" associati a un formato: la lista
 * manuale (associatedVideos) se presente e non vuota, altrimenti i video
 * trovati dalla classificazione automatica via keyword.
 *
 * Usata sia per mostrare la lista nel modal sia come PUNTO DI PARTENZA
 * quando l'utente aggiunge/rimuove un video: senza questo, aggiungere un
 * video a un formato ancora "auto-classificato" (senza associatedVideos
 * salvati) creava un associatedVideos con SOLO il nuovo video, facendo
 * sparire tutti i video già trovati via keyword dalla vista successiva.
 *
 * È anche la fonte di verità per il conteggio "N videos" mostrato nella
 * card del formato (vedi renderFormatCards): così il numero riflette
 * sempre lo stato reale, incluse le modifiche manuali fatte nel modal
 * "View", invece di restare legato solo al keyword-matching automatico.
 */
function getEffectiveAssociatedVideos(format, formats, allVideos) {

    if (Array.isArray(format.associatedVideos) && format.associatedVideos.length > 0) {

        const currentVideoTitles = new Set(allVideos.map(v => getVideoTitle(v)));
        return format.associatedVideos.filter(title => currentVideoTitles.has(title));

    }

    const classified = classifyVideos(allVideos, formats);
    return classified
        .filter(video => video.format === format.name)
        .map(video => getVideoTitle(video));

}

async function viewFormat(index, options = {}) {
    const formats = await loadCustomFormats();
    const allVideos = getDashboardData();

    const needsMigration = migrateVideoIdsToTitles(formats, allVideos);
    if (needsMigration) {
        await saveCustomFormats(formats);
            window.dispatchEvent(new CustomEvent("brawl:formats-changed"));
    }

    const format = formats[index];
    const associatedVideos = getEffectiveAssociatedVideos(format, formats, allVideos);

    createFormatDetailModal(format, associatedVideos, allVideos, index, options.searchQuery || "");
    showFormatDetailModal();
}

function createModal() {
    console.log("createModal called");
    
    // Remove existing modal if any
    const existing = document.getElementById('format-modal-overlay');
    if (existing) {
        console.log("Removing existing modal overlay");
        existing.remove();
    }

    const allVideos = getDashboardData();
    const allTitles = Array.from(new Set(allVideos.map(video => getVideoTitle(video)).filter(Boolean)));

    console.log(`Available videos for format: ${allTitles.length}`);

    // Selezione tenuta in memoria (non ancora salvata) finché non si
    // preme "Create format".
    const selectedVideos = new Set();

    const videoPickerHtml = allTitles.length > 0 ? `
        <div class="search-box improved-search">
            <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input type="text" class="search-input improved-input" id="format-video-search" placeholder="Search videos...">
        </div>
        <div class="video-picker-list video-picker-list-compact improved-list" id="format-videos-picker">
            ${allTitles.map(title => `
                <div class="video-picker-row improved-row" data-video-title="${title}">
                    <span class="video-picker-check improved-check"></span>
                    <span class="video-picker-title improved-title">${title}</span>
                </div>
            `).join('')}
        </div>
    ` : `<p class="modal-hint improved-hint">Upload a CSV to associate videos with this format.</p>`;

    const overlay = document.createElement('div');
    overlay.id = 'format-modal-overlay';
    overlay.className = 'modal-overlay improved-overlay';
    overlay.innerHTML = `
        <div class="modal improved-modal">
            <div class="modal-header improved-header">
                <div class="format-detail-heading improved-heading">
                    <span class="format-detail-icon improved-icon">✨</span>
                    <div class="heading-content">
                        <h3 class="modal-title improved-title">New Format</h3>
                        <p class="modal-subtitle improved-subtitle">Create a custom format — the AI will generate matching keywords automatically.</p>
                    </div>
                </div>
            </div>
            <div class="modal-body improved-body">
                <div class="modal-field improved-field">
                    <label class="modal-label improved-label">Name</label>
                    <input type="text" class="modal-input improved-input" id="format-name-input" placeholder="e.g., Funny Moments">
                </div>
                <div class="modal-field improved-field">
                    <label class="modal-label improved-label">Description</label>
                    <textarea class="modal-textarea improved-textarea" id="format-description-input" placeholder="Briefly describe this format..."></textarea>
                </div>
                <div class="video-picker improved-picker">
                    <div class="section-header improved-section-header">
                        <label class="modal-label improved-label" style="margin:0;">Videos <span class="modal-hint improved-hint" style="display:inline;margin:0;">(optional, helps the AI)</span></label>
                        <span class="section-count improved-count" id="format-videos-selected-count">0 selected</span>
                    </div>
                    ${videoPickerHtml}
                </div>
            </div>
            <div class="modal-footer improved-footer">
                <button class="modal-btn modal-btn-cancel improved-btn-cancel" id="modal-cancel">Cancel</button>
                <button class="modal-btn modal-btn-confirm improved-btn-confirm" id="modal-create">Create format</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    console.log("Modal overlay appended to body");

    // Show modal with a small delay to ensure DOM is ready
    setTimeout(() => {
        overlay.classList.add('active');
        console.log("Modal active class added");
    }, 10);

    // Event listeners
    document.getElementById('modal-cancel').addEventListener('click', hideModal);
    document.getElementById('modal-create').addEventListener('click', () => handleCreateFormat(selectedVideos));

    const searchInput = document.getElementById('format-video-search');
    searchInput?.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase();
        overlay.querySelectorAll('#format-videos-picker .video-picker-row').forEach(row => {
            const matches = row.dataset.videoTitle.toLowerCase().includes(query);
            row.style.display = matches ? '' : 'none';
        });
    });

    overlay.querySelectorAll('#format-videos-picker .video-picker-row').forEach(row => {
        row.addEventListener('click', () => {
            const title = row.dataset.videoTitle;

            if (selectedVideos.has(title)) {
                selectedVideos.delete(title);
                row.classList.remove('selected');
            } else {
                selectedVideos.add(title);
                row.classList.add('selected');
            }

            const counter = document.getElementById('format-videos-selected-count');
            if (counter) {
                counter.textContent = `${selectedVideos.size} selected`;
            }
        });
    });

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) hideModal();
    });

    // Close on escape
    document.addEventListener('keydown', handleEscape);
}

function handleEscape(event) {
    if (event.key === 'Escape') {
        hideModal();
        hideFormatDetailModal();
        document.removeEventListener('keydown', handleEscape);
    }
}

async function handleCreateFormat(selectedVideos) {
    const nameInput = document.getElementById('format-name-input');
    const descriptionInput = document.getElementById('format-description-input');
    const createBtn = document.getElementById('modal-create');
    
    const name = nameInput.value.trim();
    const description = descriptionInput.value.trim();
    const selected = Array.from(selectedVideos || []);
    
    if (!name) {
        nameInput.style.borderColor = 'var(--color-danger)';
        return;
    }
    
    nameInput.style.borderColor = '';
    createBtn.disabled = true;
    createBtn.textContent = 'Creating...';

    try {
        const keywords = await generateKeywordsForFormat(name, description, selected);
        const newFormat = { name, description, keywords, associatedVideos: selected };
        const formats = await loadCustomFormats();
        formats.push(newFormat);
        await saveCustomFormats(formats);
        invalidateChannelProfileCache();
        hideModal();
        await renderFormatCards();

    } catch (error) {
        console.error('Error creating format:', error);
        alert('Failed to create format. Please try again.');
    } finally {
        createBtn.disabled = false;
        createBtn.textContent = 'Create';
    }
}


function initFormatsManager() {
    if (formatsManagerInitialized) return;
    
    const createBtn = document.getElementById('create-format-btn');
    if (createBtn) {
        createBtn.addEventListener('click', () => {
            createModal();
            showModal();
        });
    }
    
    formatsManagerInitialized = true;
}

function createFormatDetailModal(format, associatedVideos, allVideos, formatIndex, searchQuery = "") {
    // Remove existing modal if any
    const existing = document.getElementById('format-detail-modal-overlay');
    if (existing) existing.remove();

    const icon = getIconForFormat(format.name);

    const allTitles = Array.from(new Set(allVideos.map(v => getVideoTitle(v)).filter(Boolean)));
    const includedSet = new Set(associatedVideos);

    // Video inclusi per primi (nell'ordine in cui sono associati), poi
    // il resto del canale — così l'utente vede subito cosa c'è dentro.
    const orderedTitles = [
        ...associatedVideos,
        ...allTitles.filter(title => !includedSet.has(title))
    ];

    const checkIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

    const rowsHtml = orderedTitles.map(title => {
        const included = includedSet.has(title);
        return `
            <div class="video-picker-row ${included ? 'selected' : ''}" data-video-title="${title}">
                <span class="video-picker-check">${included ? checkIcon : ''}</span>
                <span class="video-picker-title">${title}</span>
            </div>`;
    }).join('');

    const overlay = document.createElement('div');
    overlay.id = 'format-detail-modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal modal-large modal-format-detail">
            <div class="modal-header">
                <div class="modal-header-content">
                    <div class="format-detail-heading">
                        <span class="format-detail-icon">${icon}</span>
                        <div>
                            <h3 class="modal-title">${format.name}</h3>
                            <p class="modal-subtitle">${format.description || 'No description yet'}</p>
                        </div>
                    </div>
                    <div class="format-badge">
                        <span class="badge-count">${associatedVideos.length}</span>
                        <span class="badge-label">videos</span>
                    </div>
                </div>
            </div>
            <div class="modal-body">
                <div class="video-picker">
                    <div class="section-header">
                        <h4 class="section-title">🎬 Manage videos</h4>
                        <span class="section-count">${orderedTitles.length} total</span>
                    </div>
                    <p class="modal-hint">Click a video to add or remove it from this format.</p>
                    ${orderedTitles.length > 0 ? `
                    <div class="search-box">
                        <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                        <input type="text" class="search-input" id="video-picker-search" placeholder="Search videos...">
                    </div>
                    <div class="video-picker-list" id="video-picker-list">
                        ${rowsHtml}
                    </div>
                    ` : `
                    <div class="empty-state">
                        <p class="no-videos">No videos available</p>
                        <p class="empty-hint">Upload a CSV to see your videos here</p>
                    </div>
                    `}
                </div>
            </div>
            <div class="modal-footer">
                <button class="modal-btn modal-btn-cancel" id="detail-modal-close">Close</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Event listeners
    document.getElementById('detail-modal-close').addEventListener('click', hideFormatDetailModal);

    const searchInput = document.getElementById('video-picker-search');
    if (searchInput) {

        searchInput.value = searchQuery;

        const applyFilter = () => {
            const query = searchInput.value.toLowerCase();
            overlay.querySelectorAll('.video-picker-row').forEach(row => {
                const matches = row.dataset.videoTitle.toLowerCase().includes(query);
                row.style.display = matches ? '' : 'none';
            });
        };

        searchInput.addEventListener('input', applyFilter);
        applyFilter();

    }

    overlay.querySelectorAll('.video-picker-row').forEach(row => {
    row.addEventListener('click', async () => {
        const title = row.dataset.videoTitle;
        const currentSearch = document.getElementById('video-picker-search')?.value || '';
        await toggleAssociatedVideo(formatIndex, title, currentSearch);
        });
    });

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) hideFormatDetailModal();
    });

    // Close on escape
    document.addEventListener('keydown', handleEscape);
}

function showFormatDetailModal() {
    const overlay = document.getElementById('format-detail-modal-overlay');
    if (overlay) {
        overlay.classList.add('active');
    }
}

/**
 * Aggiunge o rimuove un video da un formato con un solo click, partendo
 * SEMPRE dalla lista "effettiva" (manuale o auto-classificata). Questo
 * risolve il bug per cui aggiungere un video a un formato ancora
 * auto-classificato faceva sparire tutti gli altri video già rilevati
 * via keyword.
 */
async function toggleAssociatedVideo(formatIndex, videoTitle, searchQuery) {
    const formats = await loadCustomFormats();
    const format = formats[formatIndex];
    const allVideos = getDashboardData();

    const effectiveVideos = getEffectiveAssociatedVideos(format, formats, allVideos);
    const isIncluded = effectiveVideos.includes(videoTitle);

    format.associatedVideos = isIncluded
        ? effectiveVideos.filter(title => title !== videoTitle)
        : [...effectiveVideos, videoTitle];

    await saveCustomFormats(formats);
        window.dispatchEvent(new CustomEvent("brawl:formats-changed"));
    invalidateChannelProfileCache();
    await viewFormat(formatIndex, { searchQuery });
    await renderFormatCards();
}

export { initFormatsManager, renderFormatCards, createModal, getEffectiveAssociatedVideos };