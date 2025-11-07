// =======================================================
//                   GLOBAL STATE & INIT
// =======================================================

const STORAGE_KEY = 'study_playlist_simple';
const SESSION_KEY = 'study_session_restore'; 
const SETTINGS_KEY = 'timer_settings_store'; 
const THEME_KEY = 'app_theme_mode'; 
const YOUTUBE_OEMBED_API = 'https://www.youtube.com/oembed?url=';
const ALARM_FADE_DURATION = 1000; 
const DEFAULT_ALARM_SOUND = 'sounds/alarm.mp3'; // <-- ĐÃ KHÔI PHỤC THEO YÊU CẦU

let player; 
let currentPlaylist = [];
let currentTrackIndex = -1;
let intervalId = null;
let currentVolume = 0.5; 
let initialTime = 0; // TỔNG thời gian ban đầu của mode hiện tại (để tính Progress Circle)

// Cấu hình mặc định
const timerSettings = {
    study: 25 * 60, 
    shortBreak: 5 * 60,
    longBreak: 15 * 60,
    totalCycles: 4, 
    // Dữ liệu cài đặt thô (Giờ/Phút) để lưu vào Local Storage
    raw: {
        studyHour: 0, studyMinute: 25,
        shortBreak: 5, // Đơn vị: Phút
        longBreak: 15, // Đơn vị: Phút
        totalCycles: 4
    }
};

let currentMode = 'study';
let timeLeft = timerSettings.study;
let isRunning = false;
let cycleCount = 0; 
let pendingRestore = null; // CHỨA DỮ LIỆU KHÔI PHỤC
let currentTheme = 'dark'; // Mặc định là dark
let isSettingsOpen = false; // Trạng thái mở/đóng của cài đặt

// Elements
const playlistListEl = document.getElementById('playlist-list');
const urlInputEl = document.getElementById('youtube-url');
const errorEl = document.getElementById('playlist-error');
const timerDisplayEl = document.getElementById('countdown');
const timerModeEl = document.getElementById('timer-mode');
const cycleInfoEl = document.getElementById('cycle-info');
const startPauseBtn = document.getElementById('btn-start-pause');
const resetBtn = document.getElementById('btn-reset');
const skipBtn = document.getElementById('btn-skip');
const alarmSound = document.getElementById('alarm-sound');
const progressCircle = document.getElementById('progress-circle');
const themeToggleBtn = document.getElementById('theme-toggle');
const settingsToggleBtn = document.getElementById('btn-settings');
const settingsAreaEl = document.getElementById('settings-area');

// Modal Elements
const videoRestoreModalEl = document.getElementById('video-restore-modal');
const btnRestoreVideo = document.getElementById('btn-restore-video');
const btnSkipVideo = document.getElementById('btn-skip-video');
const timerRestoreModalEl = document.getElementById('timer-restore-modal');
const btnRestoreTimer = document.getElementById('btn-restore-timer');
const btnSkipTimer = document.getElementById('btn-skip-timer');
const settingsRestoreModalEl = document.getElementById('settings-restore-modal');
const btnRestoreSettings = document.getElementById('btn-restore-settings');
const btnSkipSettings = document.getElementById('btn-skip-settings');

// Input Elements (Cho phần Cài đặt)
const studyHourInput = document.getElementById('study-hour');
const studyMinuteInput = document.getElementById('study-minute');
const shortBreakInput = document.getElementById('short-break');
const longBreakInput = document.getElementById('long-break');
const totalCyclesInput = document.getElementById('total-cycles');


// =======================================================
//                   UTILITY FUNCTIONS
// =======================================================

const formatTime = (totalSeconds) => {
    if (totalSeconds <= 0) {
        return '00:00'; 
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
};

const getYouTubeId = (url) => {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|\w\/\w\/|v=)|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(regex);
    return (match && match[1]?.length === 11) ? match[1] : null;
};

const savePlaylist = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentPlaylist));
};

const loadPlaylist = () => {
    const savedPlaylist = localStorage.getItem(STORAGE_KEY);
    if (savedPlaylist) {
        currentPlaylist = JSON.parse(savedPlaylist);
    }
};

const saveSettings = () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(timerSettings.raw));
};

const calculateTimerSettings = () => {
    const raw = timerSettings.raw;
    // Tính tổng giây cho các mode
    timerSettings.study = (parseInt(raw.studyHour) * 3600) + (parseInt(raw.studyMinute) * 60);
    timerSettings.shortBreak = parseInt(raw.shortBreak) * 60;
    timerSettings.longBreak = parseInt(raw.longBreak) * 60;
    timerSettings.totalCycles = parseInt(raw.totalCycles);
};

const loadSettings = () => {
    const savedSettings = localStorage.getItem(SETTINGS_KEY);
    if (savedSettings) {
        // Cập nhật timerSettings.raw và tính toán lại thời gian
        timerSettings.raw = JSON.parse(savedSettings);
        calculateTimerSettings();
        
        // Cập nhật giá trị hiển thị trên Input
        studyHourInput.value = timerSettings.raw.studyHour;
        studyMinuteInput.value = timerSettings.raw.studyMinute;
        shortBreakInput.value = timerSettings.raw.shortBreak;
        longBreakInput.value = timerSettings.raw.longBreak;
        totalCyclesInput.value = timerSettings.raw.totalCycles;

        // Nếu có session cũ, đánh dấu là có settings cũ để hỏi người dùng
        const savedSession = sessionStorage.getItem(SESSION_KEY);
        if (savedSession) {
            pendingRestore = pendingRestore || {};
            pendingRestore.settings = timerSettings.raw; 
        } else {
            // Nếu không có session cũ, apply luôn setting
            initialTime = timerSettings[currentMode];
            timeLeft = initialTime;
            updateDisplay();
        }
    }
    // Đảm bảo initialTime được set ngay cả khi không có settings cũ
    initialTime = timerSettings[currentMode];
    timeLeft = initialTime;
    updateDisplay();
};

const saveSession = () => {
    // Chỉ lưu Session nếu Timer đang chạy, hoặc đang Tạm dừng
    if (isRunning || startPauseBtn.textContent === '▶ Tiếp Tục') { 
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
            video: {
                // Sửa lỗi: đảm bảo chỉ lưu video ID khi có playlist và index hợp lệ
                id: currentPlaylist[currentTrackIndex]?.id || null, 
                time: player ? player.getCurrentTime() : 0,
                index: currentTrackIndex,
                isPlaying: player ? (player.getPlayerState() === YT.PlayerState.PLAYING) : false,
                title: currentPlaylist[currentTrackIndex]?.title || 'Không có video đang phát', 
            },
            timer: {
                currentMode: currentMode,
                timeLeft: timeLeft,
                isRunning: isRunning,
                cycleCount: cycleCount,
            }
        }));
    } else {
        sessionStorage.removeItem(SESSION_KEY);
    }
};

const closeAllModalsAndClearSession = () => {
    videoRestoreModalEl.style.display = 'none';
    timerRestoreModalEl.style.display = 'none';
    settingsRestoreModalEl.style.display = 'none';
    sessionStorage.removeItem(SESSION_KEY);
    pendingRestore = null;
};

// =======================================================
//                   THEME LOGIC
// =======================================================

const loadTheme = () => {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme) {
        currentTheme = savedTheme;
    }
    applyTheme(currentTheme);
};

const applyTheme = (theme) => {
    document.body.classList.toggle('light-mode', theme === 'light');
    themeToggleBtn.innerHTML = theme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    localStorage.setItem(THEME_KEY, theme);
    updateDisplay(); 
};


// =======================================================
//                   TIMER LOGIC
// =======================================================

const updateDisplay = () => {
    timerDisplayEl.textContent = formatTime(timeLeft);
    cycleInfoEl.textContent = `Chu kỳ: ${cycleCount} / ${timerSettings.totalCycles}`;
    
    let modeText = '';
    let modeClass = '';
    let modeColor = '';

    if (currentMode === 'study') {
        modeText = 'TẬP TRUNG HỌC';
        modeClass = 'study-mode';
        modeColor = 'var(--color-study)';
    } else if (currentMode === 'shortBreak') {
        modeText = 'NGHỈ NGẮN';
        modeClass = 'break-mode';
        modeColor = 'var(--color-break)';
    } else {
        modeText = 'NGHỈ DÀI';
        modeClass = 'break-mode';
        modeColor = 'var(--color-break)';
    }

    timerModeEl.textContent = modeText;
    timerModeEl.className = modeClass;
    
    // Cập nhật Progress Circle
    const totalTime = initialTime; // Sử dụng initialTime đã được set
    const percentage = totalTime > 0 ? 100 - (timeLeft / totalTime) * 100 : 0;
    
    progressCircle.style.background = `conic-gradient(${modeColor} ${percentage}%, var(--circle-bg) ${percentage}%)`;
};

const startTimer = () => {
    if (isRunning) return; 

    isRunning = true;
    startPauseBtn.innerHTML = '⏸ Tạm Dừng';

    // Đảm bảo video play khi bắt đầu/tiếp tục timer
    if (player && player.playVideo && player.getPlayerState() !== YT.PlayerState.PLAYING) {
        player.playVideo();
    }

    intervalId = setInterval(() => {
        timeLeft--;
        updateDisplay();

        if (timeLeft <= 0) {
            clearInterval(intervalId);
            intervalId = null;
            isRunning = false;
            
            switchMode();
        }
    }, 1000);
};

const pauseTimer = (updateButton = true) => {
    clearInterval(intervalId);
    intervalId = null;
    isRunning = false;
    if (updateButton) {
        startPauseBtn.textContent = '▶ Tiếp Tục';
    }
    // Đảm bảo video pause khi tạm dừng timer
    if (player && player.pauseVideo) {
        player.pauseVideo();
    }
    saveSession();
};

const resetTimerToCurrentMode = () => {
    initialTime = timerSettings[currentMode];
    timeLeft = initialTime;
    updateDisplay();
};

const resetTimer = () => {
    pauseTimer(false); // Pause nhưng không đổi nút
    currentMode = 'study';
    cycleCount = 0;
    startPauseBtn.textContent = '▶ Bắt Đầu';
    resetTimerToCurrentMode(); 
    saveSession(); // Xóa session
};

// =======================================================
//                   MODE SWITCHING & ALARM
// =======================================================

const fadeAlarm = (isStart) => {
    return new Promise((resolve) => {
        alarmSound.volume = 0.5;
        alarmSound.currentTime = 0;
        alarmSound.src = DEFAULT_ALARM_SOUND; // Sử dụng đường dẫn local

        if (isStart) {
            alarmSound.play().catch(e => console.log("Lỗi phát âm thanh:", e)); 
        }
        
        // Logic fade out (chỉ chạy 3 giây)
        let volume = 0.5;
        const fadeInterval = setInterval(() => {
            volume -= 0.05; 
            if (volume <= 0) {
                alarmSound.pause();
                alarmSound.currentTime = 0; 
                clearInterval(fadeInterval);
                resolve();
            }
            alarmSound.volume = Math.max(0, volume);
        }, ALARM_FADE_DURATION / 10); 
        
        setTimeout(() => {
            clearInterval(fadeInterval);
            alarmSound.pause();
            alarmSound.volume = 0.5;
            resolve();
        }, 3000); // Dừng hẳn sau 3 giây
    });
};

const switchMode = async () => {
    pauseTimer(false); 
    if (player && player.pauseVideo) {
        player.pauseVideo();
    }
    
    await fadeAlarm(true); 
    
    // Chuyển mode
    if (currentMode === 'study') {
        cycleCount++;
        if (cycleCount % timerSettings.totalCycles === 0) {
            currentMode = 'longBreak';
        } else {
            currentMode = 'shortBreak';
        }
    } else { 
        currentMode = 'study';
    }

    resetTimerToCurrentMode(); 
    
    // Tự động bắt đầu mode mới
    startTimer();
};


// =======================================================
//                   YOUTUBE PLAYER LOGIC
// =======================================================

function onYouTubeIframeAPIReady() {
    // Bắt đầu kiểm tra khôi phục sau khi YT API sẵn sàng
    checkRestoreStatus();
}

function createPlayer(videoId, startSeconds = 0) {
    document.getElementById('player-placeholder').style.display = 'none';

    // Xóa player cũ trước khi tạo player mới nếu player đã tồn tại
    if (player) {
        player.destroy();
    }

    player = new YT.Player('youtube-player', {
        videoId: videoId,
        playerVars: {
            'controls': 1,
            'rel': 0,
            'modestbranding': 1,
            'start': startSeconds,
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
}

function onPlayerReady(event) {
    // Đảm bảo index được cập nhật cho lần load đầu tiên (nếu không có khôi phục)
    if (currentPlaylist.length > 0 && currentTrackIndex === -1 && (!pendingRestore || !pendingRestore.session)) {
        currentTrackIndex = 0;
        document.getElementById('playlist-list').querySelector('li')?.classList.add('current-track');
    }
}

function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.ENDED) {
        playNextTrack();
    }
    const playPauseIcon = document.getElementById('btn-play-pause').querySelector('i');
    if (event.data === YT.PlayerState.PLAYING) {
        playPauseIcon.className = 'fas fa-pause';
    } else {
        playPauseIcon.className = 'fas fa-play';
    }
    saveSession(); 
}

const playVideoAtIndex = (index, autoPlay = true, startSeconds = 0) => {
    if (index >= 0 && index < currentPlaylist.length) {
        currentTrackIndex = index;
        const videoId = currentPlaylist[index].id;
        
        document.querySelectorAll('.playlist-list li').forEach((li, i) => {
            li.classList.toggle('current-track', i === index);
        });

        if (player && player.loadVideoById) {
            player.loadVideoById({
                'videoId': videoId,
                'startSeconds': startSeconds
            });
            if (!autoPlay) {
                // Sử dụng setTimeout để đảm bảo lệnh pause được gọi sau khi video load xong
                setTimeout(() => {
                    player.pauseVideo();
                }, 100); 
            }
        } else {
            // Nếu player chưa tạo, tạo player mới
            createPlayer(videoId, startSeconds);
            if (!autoPlay && player) {
                 setTimeout(() => {
                    player.pauseVideo();
                }, 500);
            }
        }
        
        document.getElementById('player-placeholder').style.display = 'none';
    }
};

const playNextTrack = () => {
    if (currentPlaylist.length === 0) return;
    currentTrackIndex = (currentTrackIndex + 1) % currentPlaylist.length;
    playVideoAtIndex(currentTrackIndex, true, 0);
};

const playPrevTrack = () => {
    if (currentPlaylist.length === 0) return;
    currentTrackIndex = (currentTrackIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
    playVideoAtIndex(currentTrackIndex, true, 0);
};


// =======================================================
//                   PLAYLIST & UI LOGIC
// =======================================================

const renderPlaylist = () => {
    playlistListEl.innerHTML = '';
    
    // Cập nhật số lượng bài hát trên tiêu đề
    document.querySelector('#playlist-section h2').textContent = `Playlist (${currentPlaylist.length})`;

    if (currentPlaylist.length === 0) {
        document.getElementById('player-placeholder').style.display = 'flex';
        return;
    } else {
         document.getElementById('player-placeholder').style.display = 'none';
    }

    currentPlaylist.forEach((track, index) => {
        const li = document.createElement('li');
        li.draggable = true;
        li.dataset.index = index;
        li.classList.toggle('current-track', index === currentTrackIndex);
        
        const titleSpan = document.createElement('span');
        titleSpan.textContent = `${index + 1}. ${track.title}`;
        titleSpan.title = track.title;
        titleSpan.addEventListener('click', () => {
            playVideoAtIndex(index, true, 0);
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
        deleteBtn.title = 'Xóa khỏi Playlist';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeSong(index);
        });

        const dragHandle = document.createElement('button');
        dragHandle.innerHTML = '<i class="fas fa-grip-vertical"></i>';
        dragHandle.title = 'Kéo để sắp xếp';
        dragHandle.classList.add('drag-handle');
        dragHandle.addEventListener('mousedown', (e) => e.stopPropagation()); 

        li.appendChild(dragHandle);
        li.appendChild(titleSpan);
        li.appendChild(deleteBtn);
        
        li.addEventListener('dragstart', handleDragStart);
        li.addEventListener('dragenter', handleDragEnter);
        li.addEventListener('dragover', handleDragOver);
        li.addEventListener('dragleave', handleDragLeave);
        li.addEventListener('drop', handleDrop);
        li.addEventListener('dragend', handleDragEnd);

        playlistListEl.appendChild(li);
    });
};

const removeSong = (index) => {
    currentPlaylist.splice(index, 1);
    
    if (currentTrackIndex === index) {
        currentTrackIndex = -1;
    } else if (currentTrackIndex > index) {
        currentTrackIndex--;
    }
    
    savePlaylist();
    renderPlaylist();
    
    if (currentPlaylist.length === 0) {
        document.getElementById('player-placeholder').style.display = 'flex';
        if(player && player.stopVideo) player.stopVideo();
        pauseTimer(); // Dừng timer nếu playlist trống
    } else if (currentTrackIndex === -1) {
        // Load video đầu tiên và tạm dừng (mục đích là để hiển thị)
        playVideoAtIndex(0, false, 0); 
    }
};

const addSong = async (url) => {
    errorEl.textContent = '';
    const videoId = getYouTubeId(url);
    if (!videoId) {
        errorEl.textContent = 'Lỗi: URL không hợp lệ hoặc không tìm thấy Video ID.';
        return;
    }

    if (currentPlaylist.some(track => track.id === videoId)) {
        errorEl.textContent = 'Video này đã có trong Playlist.';
        return;
    }

    try {
        const response = await fetch(`${YOUTUBE_OEMBED_API}${encodeURIComponent(url)}&format=json`);
        const data = await response.json();
        
        const newTrack = {
            id: videoId,
            title: data.title,
            thumbnail: data.thumbnail_url
        };
        
        currentPlaylist.push(newTrack);
        savePlaylist();
        renderPlaylist();
        urlInputEl.value = '';

        if (currentPlaylist.length === 1) {
            currentTrackIndex = 0;
            playVideoAtIndex(0, true, 0);
        }
        
    } catch (e) {
        errorEl.textContent = 'Lỗi: Không thể lấy thông tin video từ YouTube.';
        console.error("Lỗi fetch YouTube oEmbed:", e);
    }
};


// =======================================================
//                   DRAG & DROP LOGIC
// =======================================================

let draggedItem = null;

function handleDragStart(e) {
    draggedItem = this;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => this.classList.add('dragging'), 0);
}

function handleDragEnter(e) {
    e.preventDefault();
    if (this !== draggedItem) {
        this.classList.add('drag-over');
    }
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDragLeave() {
    this.classList.remove('drag-over');
}

function handleDrop(e) {
    e.stopPropagation(); 
    this.classList.remove('drag-over');

    if (draggedItem !== this) {
        const fromIndex = parseInt(draggedItem.dataset.index);
        const toIndex = parseInt(this.dataset.index);

        const [movedItem] = currentPlaylist.splice(fromIndex, 1);
        currentPlaylist.splice(toIndex, 0, movedItem);

        // Cập nhật currentTrackIndex sau khi sắp xếp
        if (currentTrackIndex === fromIndex) {
            currentTrackIndex = toIndex;
        } else if (fromIndex < currentTrackIndex && toIndex >= currentTrackIndex) {
            currentTrackIndex--;
        } else if (fromIndex > currentTrackIndex && toIndex <= currentTrackIndex) {
            currentTrackIndex++;
        }
        
        savePlaylist();
        renderPlaylist();
    }
}

function handleDragEnd() {
    this.classList.remove('dragging');
    document.querySelectorAll('.playlist-list li').forEach(item => item.classList.remove('drag-over'));
    draggedItem = null;
}

// =======================================================
//                   MODAL RESTORE LOGIC (ĐÃ SỬA LỖI ỔN ĐỊNH)
// =======================================================

const showSettingsRestorePhase = (settings) => {
    // FIX: Nếu không có settings thì bỏ qua
    if (!settings) {
        if (pendingRestore?.session) {
            showVideoRestorePhase();
        }
        return;
    }

    const infoEl = document.getElementById('settings-restore-info');
    infoEl.innerHTML = `
        <p><strong>Học:</strong> ${settings.studyHour} giờ ${settings.studyMinute} phút</p>
        <p><strong>Nghỉ Ngắn:</strong> ${settings.shortBreak} phút</p>
        <p><strong>Nghỉ Dài:</strong> ${settings.longBreak} phút</p>
        <p><strong>Chu kỳ:</strong> ${settings.totalCycles} lần</p>
    `;

    settingsRestoreModalEl.style.display = 'flex';
};

/** * Sửa lỗi: Kiểm tra session và video data an toàn trước khi hiển thị
 */
const showVideoRestorePhase = () => {
    const videoData = pendingRestore?.session?.video;

    // FIX QUAN TRỌNG: Nếu không có session, video data, hoặc playlist trống, BỎ QUA MODAL VIDEO
    if (!videoData || !videoData.id || currentPlaylist.length === 0 || 
        videoData.index < 0 || videoData.index >= currentPlaylist.length) {
        
        // Chuyển sang hỏi Timer ngay
        showTimerRestorePhase();
        return;
    }
    
    // Gán dữ liệu vào button và hiển thị nội dung
    btnRestoreVideo.dataset.time = videoData.time;
    btnRestoreVideo.dataset.index = videoData.index;
    btnRestoreVideo.dataset.play = videoData.isPlaying ? 'true' : 'false';

    document.getElementById('video-restore-info').innerHTML = `
        <p><strong>Bài hát:</strong> ${videoData.title || 'Không rõ tiêu đề'}</p>
        <p><strong>Thời gian:</strong> ${formatTime(Math.floor(videoData.time))}</p>
        <p><strong>Trạng thái:</strong> ${videoData.isPlaying ? 'Đang chạy' : 'Tạm dừng'}</p>
    `;
    
    videoRestoreModalEl.style.display = 'flex';
};

/** * Sửa lỗi: Kiểm tra session data an toàn trước khi hiển thị
 */
const showTimerRestorePhase = () => {
    const timerData = pendingRestore?.session?.timer;
    
    // FIX QUAN TRỌNG: Nếu không có session hoặc timer data hợp lệ, ĐÓNG TẤT CẢ
    if (!timerData) {
        closeAllModalsAndClearSession();
        return;
    }
    
    // Cải thiện nội dung hiển thị mode
    const modeText = timerData.currentMode === 'study' ? 'Học' : 
                     timerData.currentMode === 'shortBreak' ? 'Nghỉ Ngắn' : 'Nghỉ Dài';

    document.getElementById('timer-restore-info').innerHTML = `
        <p><strong>Chế độ:</strong> ${modeText}</p>
        <p><strong>Còn lại:</strong> ${formatTime(timerData.timeLeft)}</p>
        <p><strong>Chu kỳ:</strong> ${timerData.cycleCount} / ${timerSettings.totalCycles}</p>
        <p><strong>Trạng thái:</strong> ${timerData.isRunning ? 'Đang chạy' : 'Tạm dừng'}</p>
    `;
    
    timerRestoreModalEl.style.display = 'flex';
};

/** * Cập nhật luồng kiểm tra khôi phục
 */
const checkRestoreStatus = () => {
    // Luồng: Settings (nếu có) -> Video (nếu có session) -> Timer (nếu có session)
    if (pendingRestore?.settings) {
        showSettingsRestorePhase(pendingRestore.settings);
    } else if (pendingRestore?.session) {
        // Nếu không có settings cũ, chuyển sang Video/Timer ngay
        showVideoRestorePhase(); 
    }
    // Nếu không có gì để khôi phục, ứng dụng chạy bình thường.
};

// =======================================================
//                   EVENT LISTENERS
// =======================================================

// Timer Controls Events
startPauseBtn.addEventListener('click', () => {
    if (isRunning) {
        pauseTimer();
    } else {
        startTimer();
    }
});

resetBtn.addEventListener('click', resetTimer);
skipBtn.addEventListener('click', switchMode);

// Playlist Controls Events
document.getElementById('btn-add-song').addEventListener('click', () => addSong(urlInputEl.value));
document.getElementById('btn-play-pause').addEventListener('click', () => {
    if (player && player.getPlayerState() === YT.PlayerState.PLAYING) {
        player.pauseVideo();
    } else if (player) {
        player.playVideo();
    }
});
document.getElementById('btn-prev').addEventListener('click', playPrevTrack);
document.getElementById('btn-next').addEventListener('click', playNextTrack);

themeToggleBtn.addEventListener('click', () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(currentTheme);
});

// Settings Toggle
settingsToggleBtn.addEventListener('click', () => {
    isSettingsOpen = !isSettingsOpen;
    settingsAreaEl.classList.toggle('show', isSettingsOpen);
});

// Input Settings Events 
const handleSettingsChange = (e) => {
    let value = parseInt(e.target.value);
    if (isNaN(value) || value < 0) {
        value = 0;
    }
    e.target.value = value;
    
    if (e.target.id === 'study-hour') timerSettings.raw.studyHour = value;
    if (e.target.id === 'study-minute') timerSettings.raw.studyMinute = value;
    if (e.target.id === 'short-break') timerSettings.raw.shortBreak = value;
    if (e.target.id === 'long-break') timerSettings.raw.longBreak = value;
    if (e.target.id === 'total-cycles') timerSettings.raw.totalCycles = value;

    // Tính toán lại thời gian Pomodoro
    calculateTimerSettings();
    saveSettings();

    // Cập nhật display ngay lập tức nếu timer không chạy
    if (!isRunning) {
        resetTimerToCurrentMode();
    }
};

studyHourInput.addEventListener('input', handleSettingsChange);
studyMinuteInput.addEventListener('input', handleSettingsChange);
shortBreakInput.addEventListener('input', handleSettingsChange);
longBreakInput.addEventListener('input', handleSettingsChange);
totalCyclesInput.addEventListener('input', handleSettingsChange);


// Modal Buttons Events
// 1. Settings Restore
btnRestoreSettings.onclick = () => {
    settingsRestoreModalEl.style.display = 'none';
    if (pendingRestore?.session) {
        showVideoRestorePhase(); // Chuyển sang hỏi Video
    } else {
        closeAllModalsAndClearSession();
    }
};

btnSkipSettings.onclick = () => {
    settingsRestoreModalEl.style.display = 'none';

    // Đặt lại thời gian theo setting hiện tại (Không phải setting cũ)
    calculateTimerSettings();
    resetTimerToCurrentMode();

    if (pendingRestore?.session) {
        showVideoRestorePhase(); // Chuyển sang hỏi Video
    } else {
        closeAllModalsAndClearSession();
    }
};


// 2. Video Restore
btnRestoreVideo.onclick = (e) => {
    const startTime = parseFloat(e.target.dataset.time);
    const index = parseInt(e.target.dataset.index);
    const wasPlaying = e.target.dataset.play === 'true'; 
    
    // Nếu player đã sẵn sàng, load video và play/pause đúng trạng thái đã lưu
    if (currentPlaylist.length > index) {
        playVideoAtIndex(index, wasPlaying, startTime);
    }
    
    videoRestoreModalEl.style.display = 'none';
    showTimerRestorePhase(); // Chuyển sang hỏi Timer
};

btnSkipVideo.onclick = () => {
    // Nếu có playlist, load video đầu tiên (hoặc hiện tại) nhưng không play, từ đầu.
    if (currentPlaylist.length > 0) {
        if (currentTrackIndex === -1) currentTrackIndex = 0;
        playVideoAtIndex(currentTrackIndex, false, 0); 
    }
    
    videoRestoreModalEl.style.display = 'none';
    showTimerRestorePhase(); // Chuyển sang hỏi Timer
};

// 3. Timer Restore
btnRestoreTimer.onclick = () => {
    const { timer } = pendingRestore.session;
    currentMode = timer.currentMode;
    timeLeft = timer.timeLeft;
    cycleCount = timer.cycleCount;
    
    calculateTimerSettings(); // Đảm bảo totalTime (settings) được cập nhật
    
    // Đặt lại initialTime cho Progress Circle
    initialTime = timerSettings[currentMode]; 
    updateDisplay(); 
    
    if (timer.isRunning) {
        isRunning = true;
        startPauseBtn.innerHTML = '⏸ Tạm Dừng';
        startTimer();
    } else {
        startPauseBtn.textContent = '▶ Tiếp Tục';
    }
    
    closeAllModalsAndClearSession(); // Hoàn thành tất cả và đóng Modal
};

btnSkipTimer.onclick = () => {
    resetTimer(); // Đặt lại về mode Study mặc định
    closeAllModalsAndClearSession();
};

// =======================================================
//                   INIT
// =======================================================

const init = () => {
    loadTheme();
    loadPlaylist();
    
    // Load Session Restore (Video + Timer)
    const savedSession = sessionStorage.getItem(SESSION_KEY);
    if (savedSession) {
        pendingRestore = pendingRestore || {};
        pendingRestore.session = JSON.parse(savedSession);
    }
    
    // Load Settings Restore (Sẽ set pendingRestore.settings nếu có)
    loadSettings();

    // Cần render playlist trước để đảm bảo DOM có đủ các li
    renderPlaylist(); 
    
    // Nếu YT API chưa sẵn sàng, onYouTubeIframeAPIReady sẽ lo việc gọi checkRestoreStatus
    // Nếu đã sẵn sàng (trường hợp hiếm), ta vẫn gọi checkRestoreStatus
    if (typeof YT !== 'undefined' && YT.Player) {
        checkRestoreStatus(); 
    }
};

// Chạy Init (Bắt đầu chương trình)
init();
