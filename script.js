
// ===== SOUNDWAVE — SCRIPT.JS =====

(() => {
    'use strict';

    // ===== CONFIG =====
    const ITUNES_API = 'https://itunes.apple.com/search';
    const DEBOUNCE_MS = 400;
    const TRENDING_TERMS = ['Arijit Singh', 'AP Dhillon', 'Diljit Dosanjh', 'Shreya Ghoshal', 'Pritam', 'Badshah', 'Neha Kakkar', 'Jubin Nautiyal', 'Honey Singh', 'Atif Aslam'];
    const FEATURED_ARTIST = 'A.R. Rahman';

    // ===== DOM REFS =====
    const $ = (sel, ctx = document) => ctx.querySelector(sel);
    const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

    const navbar = $('#navbar');
    const navToggle = $('#navToggle');
    const navLinks = $('.nav-links');
    const searchInput = $('#searchInput');
    const searchBtn = $('#searchBtn');
    const resultsGrid = $('#resultsGrid');
    const resultsInfo = $('#resultsInfo');
    const loadingSpinner = $('#loadingSpinner');
    const trendingCarousel = $('#trendingCarousel');
    const trendingPrev = $('#trendingPrev');
    const trendingNext = $('#trendingNext');
    const genreGrid = $('#genreGrid');
    const genreResults = $('#genreResults');
    const genreResultsGrid = $('#genreResultsGrid');
    const genreResultsTitle = $('#genreResultsTitle');
    const closeGenreResults = $('#closeGenreResults');
    const artistSpotlight = $('#artistSpotlight');
    const scrollTopBtn = $('#scrollTopBtn');

    // Now Playing
    const npBar = $('#nowPlayingBar');
    const npArt = $('#nowPlayingArt');
    const npTitle = $('#nowPlayingTitle');
    const npArtist = $('#nowPlayingArtist');
    const npPlayPause = $('#npPlayPause');
    const npProgress = $('#npProgress');
    const npProgressFill = $('#npProgressFill');
    const npTime = $('#npTime');
    const npClose = $('#npClose');
    const npPlayIcon = $('.play-icon', npPlayPause);
    const npPauseIcon = $('.pause-icon', npPlayPause);

    // ===== STATE =====
    let currentAudio = null;
    let currentTrackId = null;
    let activeGenre = null;

    // ===== COOKIE HELPERS =====
    const HISTORY_COOKIE = 'sw_listening_history';
    const HISTORY_MAX = 50;
    const HISTORY_DAYS = 90;

    function setCookie(name, value, days) {
        const d = new Date();
        d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
        document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/;SameSite=Lax`;
    }

    function getCookie(name) {
        const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return match ? decodeURIComponent(match[2]) : null;
    }

    function getHistory() {
        try {
            const raw = getCookie(HISTORY_COOKIE);
            return raw ? JSON.parse(raw) : [];
        } catch { return []; }
    }

    function saveHistory(history) {
        setCookie(HISTORY_COOKIE, JSON.stringify(history.slice(0, HISTORY_MAX)), HISTORY_DAYS);
    }

    function addToHistory(track) {
        const history = getHistory();
        // Remove duplicate if exists (move to top)
        const filtered = history.filter(h => h.id !== track.id);
        filtered.unshift({
            id: track.id,
            title: track.title,
            artist: track.artist,
            art: track.art,
            preview: track.preview,
            playedAt: new Date().toISOString()
        });
        saveHistory(filtered);
        renderHistory();

        // Also log to Firebase Realtime Database
        logSongToFirebase(track);
    }

    // ===== GUEST CLIENT ID =====
    function getClientId() {
        let cid = localStorage.getItem('sw_client_id');
        if (!cid) {
            cid = 'guest_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('sw_client_id', cid);
        }
        return cid;
    }

    // ===== FIREBASE REALTIME DATABASE SONG LOG =====
    function logSongToFirebase(track) {
        try {
            const fb = window.swFirebase;
            if (!fb || !fb.rtdb) return; // Firebase not ready

            const now = new Date();
            const dateStr = now.toLocaleDateString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit' });
            const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

            // Determine user path: signed-in user or guest
            const user = fb.currentUser;
            const userId = user ? user.uid : getClientId();
            const userType = user ? 'users' : 'guests';
            const userName = user ? (user.displayName || user.email || 'Unknown') : 'Guest';

            const songData = {
                trackId: track.id,
                title: track.title,
                artist: track.artist,
                artwork: track.art,
                previewUrl: track.preview,
                userName: userName,
                userEmail: user ? user.email : null,
                date: dateStr,
                time: timeStr,
                timestamp: now.toISOString(),
                epochMs: now.getTime()
            };

            // Write to: songLog/{users|guests}/{userId}/{pushId}
            fb.rtdb.ref(`songLog/${userType}/${userId}`).push(songData)
                .then(() => {
                    console.log(`✅ Song logged to Firebase (${userType}):`, track.title);
                })
                .catch((err) => {
                    console.error('❌ Failed to log song:', err.code, err.message);
                    console.error('Full error:', err);
                });

            // Also log to analytics
            if (fb.analytics) {
                fb.analytics.logEvent('song_played', {
                    track_id: track.id,
                    track_title: track.title,
                    artist: track.artist
                });
            }
        } catch (e) {
            // Silently fail — don't break playback
            console.warn('Firebase song log error:', e.message);
        }
    }

    // History DOM
    const historyGrid = $('#historyGrid');
    const historyEmpty = $('#historyEmpty');
    const historyCount = $('#historyCount');
    const historyBadge = $('#historyBadge');
    const clearHistoryBtn = $('#clearHistoryBtn');

    // ===== ITUNES API =====
    async function searchItunes(term, limit = 20, entity = 'song') {
        const params = new URLSearchParams({ term, limit, entity, media: 'music' });
        const resp = await fetch(`${ITUNES_API}?${params}`);
        if (!resp.ok) throw new Error('iTunes API error');
        return resp.json();
    }

    async function lookupArtist(artistName) {
        const params = new URLSearchParams({ term: artistName, entity: 'album', limit: 12 });
        const resp = await fetch(`${ITUNES_API}?${params}`);
        if (!resp.ok) throw new Error('iTunes lookup error');
        return resp.json();
    }

    // ===== TRACK CARD RENDER =====
    function createTrackCard(track, index) {
        const card = document.createElement('div');
        card.className = 'track-card';
        card.style.animationDelay = `${index * 0.05}s`;
        const artUrl = track.artworkUrl100?.replace('100x100', '300x300') || '';
        const price = track.trackPrice > 0 ? `$${track.trackPrice.toFixed(2)}` : 'Free';
        const duration = formatDuration(track.trackTimeMillis);

        card.innerHTML = `
            <div class="track-card-art">
                <img src="${artUrl}" alt="${escHtml(track.trackName)}" loading="lazy">
                ${track.previewUrl ? `
                <button class="track-card-play" data-preview="${track.previewUrl}" data-title="${escHtml(track.trackName)}" data-artist="${escHtml(track.artistName)}" data-art="${artUrl}" data-id="${track.trackId}">
                    <svg viewBox="0 0 24 24"><polygon points="8 5 19 12 8 19"/></svg>
                </button>` : ''}
            </div>
            <div class="track-card-info">
                <div class="track-card-title" title="${escHtml(track.trackName)}">${escHtml(track.trackName)}</div>
                <div class="track-card-artist" title="${escHtml(track.artistName)}">${escHtml(track.artistName)}</div>
                <div class="track-card-meta">
                    <span>${duration}</span>
                    <span class="track-card-price">${price}</span>
                </div>
            </div>
        `;
        return card;
    }

    function createTrendingCard(track, rank) {
        const card = document.createElement('div');
        card.className = 'trending-card';
        card.style.animationDelay = `${rank * 0.06}s`;
        const artUrl = track.artworkUrl100?.replace('100x100', '400x400') || '';
        card.innerHTML = `
            <div class="track-card-art">
                <img src="${artUrl}" alt="${escHtml(track.trackName)}" loading="lazy">
                <span class="trending-rank">${rank + 1}</span>
                ${track.previewUrl ? `
                <button class="track-card-play" data-preview="${track.previewUrl}" data-title="${escHtml(track.trackName)}" data-artist="${escHtml(track.artistName)}" data-art="${artUrl}" data-id="${track.trackId}">
                    <svg viewBox="0 0 24 24"><polygon points="8 5 19 12 8 19"/></svg>
                </button>` : ''}
            </div>
            <div class="track-card-info">
                <div class="track-card-title" title="${escHtml(track.trackName)}">${escHtml(track.trackName)}</div>
                <div class="track-card-artist">${escHtml(track.artistName)}</div>
            </div>
        `;
        return card;
    }

    // ===== SEARCH =====
    async function performSearch(query) {
        if (!query.trim()) return;
        resultsGrid.innerHTML = '';
        resultsInfo.textContent = '';
        loadingSpinner.classList.add('active');

        try {
            const data = await searchItunes(query, 24);
            loadingSpinner.classList.remove('active');

            if (data.resultCount === 0) {
                resultsInfo.innerHTML = `No results found for "<strong>${escHtml(query)}</strong>". Try a different search.`;
                return;
            }

            resultsInfo.innerHTML = `Found <strong>${data.resultCount}</strong> results for "<strong>${escHtml(query)}</strong>"`;
            data.results.forEach((track, i) => {
                resultsGrid.appendChild(createTrackCard(track, i));
            });
        } catch (err) {
            loadingSpinner.classList.remove('active');
            resultsInfo.textContent = 'Something went wrong. Please try again.';
            console.error(err);
        }
    }

    // Debounce
    function debounce(fn, ms) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), ms);
        };
    }

    const debouncedSearch = debounce((q) => performSearch(q), DEBOUNCE_MS);

    searchInput.addEventListener('input', () => debouncedSearch(searchInput.value));
    searchBtn.addEventListener('click', () => performSearch(searchInput.value));
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') performSearch(searchInput.value);
    });

    // Suggestion chips
    $$('.suggestion-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            searchInput.value = chip.dataset.query;
            performSearch(chip.dataset.query);
        });
    });

    // ===== TRENDING =====
    async function loadTrending() {
        try {
            const randomTerms = TRENDING_TERMS.sort(() => 0.5 - Math.random()).slice(0, 5);
            const promises = randomTerms.map(term => searchItunes(term, 2));
            const results = await Promise.all(promises);
            const tracks = results.flatMap(r => r.results).filter(t => t.previewUrl);

            trendingCarousel.innerHTML = '';
            tracks.forEach((track, i) => {
                trendingCarousel.appendChild(createTrendingCard(track, i));
            });
        } catch (err) {
            trendingCarousel.innerHTML = '<p style="color: var(--text-muted); padding: 40px; text-align: center;">Could not load trending tracks.</p>';
            console.error(err);
        }
    }

    // Carousel scroll
    trendingPrev?.addEventListener('click', () => {
        trendingCarousel.scrollBy({ left: -300, behavior: 'smooth' });
    });
    trendingNext?.addEventListener('click', () => {
        trendingCarousel.scrollBy({ left: 300, behavior: 'smooth' });
    });

    // ===== GENRE EXPLORER =====
    $$('.genre-tile').forEach(tile => {
        tile.addEventListener('click', () => {
            const genre = tile.dataset.genre;
            if (activeGenre === genre) {
                // Toggle off
                activeGenre = null;
                tile.classList.remove('active');
                genreResults.classList.remove('active');
                return;
            }
            // Remove previous active
            $$('.genre-tile.active').forEach(t => t.classList.remove('active'));
            activeGenre = genre;
            tile.classList.add('active');
            loadGenreResults(genre);
        });
    });

    async function loadGenreResults(genre) {
        genreResultsGrid.innerHTML = '';
        genreResultsTitle.textContent = `${capitalize(genre)} tracks`;
        genreResults.classList.add('active');

        try {
            const data = await searchItunes(genre, 16);
            data.results.forEach((track, i) => {
                genreResultsGrid.appendChild(createTrackCard(track, i));
            });
            genreResults.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (err) {
            genreResultsGrid.innerHTML = '<p style="color: var(--text-muted); padding: 20px;">Could not load tracks.</p>';
        }
    }

    closeGenreResults.addEventListener('click', () => {
        genreResults.classList.remove('active');
        $$('.genre-tile.active').forEach(t => t.classList.remove('active'));
        activeGenre = null;
    });

    // Footer genre links
    $$('.genre-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const genre = link.dataset.genre;
            const tile = $(`.genre-tile[data-genre="${genre}"]`);
            if (tile) {
                tile.click();
                tile.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    });

    // ===== ARTIST SPOTLIGHT =====
    async function loadArtistSpotlight() {
        try {
            const data = await lookupArtist(FEATURED_ARTIST);
            const albums = data.results.filter(r => r.wrapperType === 'collection' || r.collectionType === 'Album');
            if (albums.length === 0) {
                artistSpotlight.innerHTML = '<p style="color: var(--text-muted); text-align: center;">Could not load artist data.</p>';
                return;
            }

            const mainArt = albums[0].artworkUrl100?.replace('100x100', '600x600') || '';
            const artistName = albums[0].artistName || FEATURED_ARTIST;
            const genre = albums[0].primaryGenreName || 'Music';

            const albumsHtml = albums.slice(0, 8).map(a => {
                const art = a.artworkUrl100?.replace('100x100', '200x200') || '';
                return `
                    <div class="album-mini" title="${escHtml(a.collectionName)}">
                        <img src="${art}" alt="${escHtml(a.collectionName)}" loading="lazy">
                        <div class="album-mini-title">${escHtml(a.collectionName)}</div>
                    </div>
                `;
            }).join('');

            artistSpotlight.innerHTML = `
                <div class="artist-card animate-on-scroll visible">
                    <div class="artist-image">
                        <img src="${mainArt}" alt="${escHtml(artistName)}">
                    </div>
                    <div class="artist-info">
                        <h3>${escHtml(artistName)}</h3>
                        <div class="artist-genre">${escHtml(genre)}</div>
                        <p>Explore the discography of ${escHtml(artistName)}. From chart-topping hits to deep cuts, discover the albums that defined a generation.</p>
                        <div class="artist-albums-label">Discography</div>
                        <div class="artist-albums">${albumsHtml}</div>
                    </div>
                </div>
            `;
        } catch (err) {
            artistSpotlight.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 40px;">Could not load artist spotlight.</p>';
            console.error(err);
        }
    }

    // ===== AUDIO PLAYER =====
    document.addEventListener('click', (e) => {
        const playBtn = e.target.closest('.track-card-play');
        if (!playBtn) return;

        const { preview, title, artist, art, id } = playBtn.dataset;
        if (!preview) return;

        if (currentTrackId === id && currentAudio) {
            // Toggle play/pause
            if (currentAudio.paused) {
                currentAudio.play();
                showPlayState(true);
            } else {
                currentAudio.pause();
                showPlayState(false);
            }
            return;
        }

        // New track
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.removeEventListener('timeupdate', onTimeUpdate);
            currentAudio.removeEventListener('ended', onTrackEnd);
        }

        currentAudio = new Audio(preview);
        currentTrackId = id;

        npArt.src = art;
        npTitle.textContent = title;
        npArtist.textContent = artist;
        npProgressFill.style.width = '0%';
        npTime.textContent = '0:00';

        npBar.classList.add('active');
        currentAudio.play();
        showPlayState(true);

        // Save to history cookie
        addToHistory({ id, title, artist, art, preview });

        currentAudio.addEventListener('timeupdate', onTimeUpdate);
        currentAudio.addEventListener('ended', onTrackEnd);
    });

    function onTimeUpdate() {
        if (!currentAudio) return;
        const pct = (currentAudio.currentTime / currentAudio.duration) * 100;
        npProgressFill.style.width = `${pct}%`;
        npTime.textContent = formatTime(currentAudio.currentTime);
    }

    function onTrackEnd() {
        showPlayState(false);
        npProgressFill.style.width = '100%';
    }

    function showPlayState(playing) {
        npPlayIcon.style.display = playing ? 'none' : 'block';
        npPauseIcon.style.display = playing ? 'block' : 'none';
    }

    npPlayPause.addEventListener('click', () => {
        if (!currentAudio) return;
        if (currentAudio.paused) {
            currentAudio.play();
            showPlayState(true);
        } else {
            currentAudio.pause();
            showPlayState(false);
        }
    });

    npProgress.addEventListener('click', (e) => {
        if (!currentAudio) return;
        const rect = npProgress.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        currentAudio.currentTime = pct * currentAudio.duration;
    });

    npClose.addEventListener('click', () => {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
            currentTrackId = null;
        }
        npBar.classList.remove('active');
    });

    // ===== NAVBAR =====
    let lastScroll = 0;
    window.addEventListener('scroll', () => {
        const sy = window.scrollY;
        navbar.classList.toggle('scrolled', sy > 50);
        lastScroll = sy;
    }, { passive: true });

    navToggle.addEventListener('click', () => {
        navLinks.classList.toggle('open');
        const spans = $$('span', navToggle);
        navLinks.classList.contains('open')
            ? (spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)', spans[1].style.opacity = '0', spans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)')
            : (spans[0].style.transform = '', spans[1].style.opacity = '1', spans[2].style.transform = '');
    });

    // Close nav on link click
    $$('.nav-links a').forEach(a => {
        a.addEventListener('click', () => {
            navLinks.classList.remove('open');
            const spans = $$('span', navToggle);
            spans[0].style.transform = '';
            spans[1].style.opacity = '1';
            spans[2].style.transform = '';
        });
    });

    // ===== SCROLL ANIMATIONS =====
    const scrollObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    function observeAnimations() {
        $$('.animate-on-scroll').forEach(el => scrollObserver.observe(el));
    }
    observeAnimations();

    // ===== PARALLAX =====
    const heroParallaxBg = $('.hero-parallax-bg');
    const artistParallaxLayer = $('.artist-parallax-layer');

    window.addEventListener('scroll', () => {
        const sy = window.scrollY;

        // Hero parallax
        if (heroParallaxBg) {
            heroParallaxBg.style.transform = `translateY(${sy * 0.35}px)`;
        }

        // Artist parallax
        if (artistParallaxLayer) {
            const artistSection = $('#artist-spotlight');
            const rect = artistSection.getBoundingClientRect();
            if (rect.top < window.innerHeight && rect.bottom > 0) {
                const offset = (rect.top / window.innerHeight) * 60;
                artistParallaxLayer.style.transform = `translateY(${offset}px)`;
            }
        }
    }, { passive: true });

    // ===== HERO PARTICLES =====
    function createParticles() {
        const container = $('#heroParticles');
        if (!container) return;
        for (let i = 0; i < 30; i++) {
            const p = document.createElement('div');
            const size = Math.random() * 3 + 1;
            p.style.cssText = `
                position: absolute;
                width: ${size}px;
                height: ${size}px;
                background: ${['var(--purple)', 'var(--cyan)', 'var(--pink)'][Math.floor(Math.random() * 3)]};
                border-radius: 50%;
                left: ${Math.random() * 100}%;
                top: ${Math.random() * 100}%;
                opacity: ${Math.random() * 0.4 + 0.1};
                animation: particleFloat ${Math.random() * 10 + 10}s ease-in-out infinite alternate;
                animation-delay: ${Math.random() * 5}s;
            `;
            container.appendChild(p);
        }

        // Inject particle animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes particleFloat {
                0% { transform: translate(0, 0) scale(1); }
                33% { transform: translate(${rand(-40, 40)}px, ${rand(-40, 40)}px) scale(1.3); }
                66% { transform: translate(${rand(-30, 30)}px, ${rand(-30, 30)}px) scale(0.8); }
                100% { transform: translate(${rand(-50, 50)}px, ${rand(-50, 50)}px) scale(1.1); }
            }
        `;
        document.head.appendChild(style);
    }

    // ===== STAT COUNTER ANIMATION =====
    function animateCounters() {
        $$('.stat-number').forEach(el => {
            const target = parseInt(el.dataset.count, 10);
            let current = 0;
            const step = target / 60;
            const interval = setInterval(() => {
                current += step;
                if (current >= target) {
                    current = target;
                    clearInterval(interval);
                }
                el.textContent = Math.floor(current);
            }, 25);
        });
    }

    // Trigger counters when hero stats become visible
    const statsObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                animateCounters();
                statsObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });

    const heroStats = $('.hero-stats');
    if (heroStats) statsObserver.observe(heroStats);

    // ===== SCROLL TO TOP =====
    scrollTopBtn?.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // ===== UTILS =====
    function escHtml(str) {
        if (!str) return '';
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    function formatDuration(ms) {
        if (!ms) return '';
        const totalSec = Math.floor(ms / 1000);
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        return `${min}:${sec.toString().padStart(2, '0')}`;
    }

    function formatTime(sec) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function capitalize(str) {
        return str.replace(/\b\w/g, c => c.toUpperCase());
    }

    function rand(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    // ===== LISTENING HISTORY =====
    function renderHistory() {
        const history = getHistory();
        const count = history.length;

        // Update badge
        if (historyBadge) historyBadge.textContent = count > 0 ? count : '';
        // Update count text
        if (historyCount) historyCount.textContent = `${count} song${count !== 1 ? 's' : ''} played`;

        // Toggle empty state
        if (historyEmpty) {
            historyEmpty.classList.toggle('active', count === 0);
        }
        if (historyGrid) {
            historyGrid.style.display = count > 0 ? 'grid' : 'none';
            historyGrid.innerHTML = '';

            history.forEach((track, i) => {
                const card = document.createElement('div');
                card.className = 'history-card';
                card.style.animationDelay = `${i * 0.04}s`;
                card.innerHTML = `
                    <div class="history-card-art" data-preview="${track.preview || ''}" data-title="${escHtml(track.title)}" data-artist="${escHtml(track.artist)}" data-art="${track.art}" data-id="${track.id}">
                        <img src="${track.art}" alt="${escHtml(track.title)}" loading="lazy">
                        <div class="history-card-art-overlay">
                            <svg viewBox="0 0 24 24"><polygon points="8 5 19 12 8 19"/></svg>
                        </div>
                    </div>
                    <div class="history-card-details">
                        <div class="history-card-title">${escHtml(track.title)}</div>
                        <div class="history-card-artist">${escHtml(track.artist)}</div>
                        <div class="history-card-time">
                            <svg viewBox="0 0 24 24" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                            ${timeAgo(track.playedAt)}
                        </div>
                    </div>
                    <button class="history-card-remove" data-history-id="${track.id}" title="Remove from history">✕</button>
                `;
                historyGrid.appendChild(card);
            });
        }
    }

    // Play from history
    document.addEventListener('click', (e) => {
        const artEl = e.target.closest('.history-card-art');
        if (!artEl) return;
        const { preview, title, artist, art, id } = artEl.dataset;
        if (!preview) return;

        // Reuse the same audio player logic
        if (currentTrackId === id && currentAudio) {
            if (currentAudio.paused) { currentAudio.play(); showPlayState(true); }
            else { currentAudio.pause(); showPlayState(false); }
            return;
        }
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.removeEventListener('timeupdate', onTimeUpdate);
            currentAudio.removeEventListener('ended', onTrackEnd);
        }
        currentAudio = new Audio(preview);
        currentTrackId = id;
        npArt.src = art; npTitle.textContent = title; npArtist.textContent = artist;
        npProgressFill.style.width = '0%'; npTime.textContent = '0:00';
        npBar.classList.add('active');
        currentAudio.play(); showPlayState(true);
        addToHistory({ id, title, artist, art, preview });
        currentAudio.addEventListener('timeupdate', onTimeUpdate);
        currentAudio.addEventListener('ended', onTrackEnd);
    });

    // Remove single history item
    document.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.history-card-remove');
        if (!removeBtn) return;
        const id = removeBtn.dataset.historyId;
        const history = getHistory().filter(h => h.id !== id);
        saveHistory(history);
        renderHistory();
    });

    // Clear all history
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', () => {
            if (getHistory().length === 0) return;
            // Show confirm dialog
            const overlay = document.createElement('div');
            overlay.className = 'history-confirm-overlay';
            overlay.innerHTML = `
                <div class="history-confirm-dialog">
                    <h3>Clear Listening History?</h3>
                    <p>This will remove all your played song records from this browser. This action cannot be undone.</p>
                    <div class="history-confirm-actions">
                        <button class="btn btn-ghost btn-sm" id="confirmCancel">Cancel</button>
                        <button class="btn-danger" id="confirmClear">Clear All</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            overlay.querySelector('#confirmCancel').addEventListener('click', () => overlay.remove());
            overlay.querySelector('#confirmClear').addEventListener('click', () => {
                setCookie(HISTORY_COOKIE, '[]', HISTORY_DAYS);
                renderHistory();
                overlay.remove();
            });
            overlay.addEventListener('click', (ev) => {
                if (ev.target === overlay) overlay.remove();
            });
        });
    }

    function timeAgo(isoStr) {
        if (!isoStr) return '';
        const diff = Date.now() - new Date(isoStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        if (days < 7) return `${days}d ago`;
        if (days < 30) return `${Math.floor(days / 7)}w ago`;
        return new Date(isoStr).toLocaleDateString();
    }

    // ===== INIT =====
    function init() {
        createParticles();
        loadTrending();
        loadArtistSpotlight();
        renderHistory();
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
