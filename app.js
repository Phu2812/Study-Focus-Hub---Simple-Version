// =======================================================
//                   GLOBAL STATE & INIT
// =======================================================

const STORAGE_KEY = 'study_playlist_simple';
const YOUTUBE_OEMBED_API = 'https://www.youtube.com/oembed?url='; // API công khai mới
const ALARM_FADE_DURATION = 1000; // 1 giây

let player; 
let currentPlaylist = [];
let currentTrackIndex = -1;
let intervalId = null;
let currentVolume = 0.5; 

const timerSettings = {
    study: 25 * 60,
    shortBreak: 5 * 60,
    longBreak: 15 * 60,
};
let currentMode = 'study';
let timeLeft = timerSettings.study;
let isRunning = false;
let cycleCount = 0;

// Elements
const playlistListEl = document.getElementById('playlist-list');
const urlInputEl = document.getElementById('youtube-url');
const errorEl = document.getElementById('playlist-error');
const timerDisplayEl = document.getElementById('countdown');
const timerModeEl = document.getElementById('timer-mode');
const cycleInfoEl = document.getElementById('cycle-info');
const startPauseBtn = document.getElementById('btn-start-pause');
const alarmSound = document.getElementById('alarm-sound');
const timerCardEl = document.getElementById('timer-section');


// =======================================================
//                   HELPER FUNCTIONS
// =======================================================

const getYouTubeVideoId = (url) => {
    const regex = /(?:youtu\.be\/|v\/|watch\?v=|embed\/)([^&"'>]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
};

// Lấy tiêu đề video từ YouTube oEmbed API
const fetchVideoTitle = async (videoId) => {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    try {
        const response = await fetch(`${YOUTUBE_OEMBED_API}${encodeURIComponent(url)}&format=json`);
        const data = await response.json();
        return data.title || `Video ${videoId}`;
    } catch (error) {
        console.error("Lỗi lấy tiêu đề:", error);
        return `Video ${videoId}`;
    }
};

const loadPlaylist = () => {
    const data = localStorage.getItem(STORAGE_KEY);
    currentPlaylist = data ? JSON.parse(data) : [];
};

const savePlaylist = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentPlaylist));
    renderPlaylist();
};


// =======================================================
//                   3. POMODORO TIMER LOGIC
// =======================================================

const formatTime = (time) => {
    const minutes = Math.floor(time / 60).toString().padStart(2, '0');
    const seconds = (time % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
};

const updateDisplay = () => {
    timerDisplayEl.textContent = formatTime(timeLeft);
    timerModeEl.textContent = currentMode === 'study' ? 'TẬP TRUNG HỌC' : 'THỜI GIAN NGHỈ';
    timerModeEl.className = currentMode === 'study' ? 'study-mode' : 'break-mode';
    timerCardEl.style.backgroundColor = currentMode === 'study' ? 'rgba(255, 99, 71, 0.1)' : 'rgba(60, 179, 113, 0.1)';
    cycleInfoEl.textContent = `Chu kỳ: ${cycleCount % 4} / 4`;
    document.title = `${formatTime(timeLeft)} - ${timerModeEl.textContent}`;
};

// Hiệu ứng Fade In/Out cho âm thanh cảnh báo
const fadeAlarm = (isFadeIn, callback) => {
    // Đặt lại âm lượng trước khi fade
    alarmSound.volume = isFadeIn ? 0 : 1;
    
    if (isFadeIn) {
        alarmSound.play().catch(e => console.error("Lỗi play audio:", e));
    }
    
    let volume = alarmSound.volume;
    const step = 0.1;
    
    const fadeInterval = setInterval(() => {
        if (isFadeIn) {
            volume += step;
            if (volume >= 1) {
                volume = 1;
                clearInterval(fadeInterval);
                if (callback) callback();
            }
        } else { // Fade Out
            volume -= step;
            if (volume <= 0) {
                volume = 0;
                alarmSound.pause();
                alarmSound.currentTime = 0;
                clearInterval(fadeInterval);
                if (callback) callback();
            }
        }
        alarmSound.volume = volume;
    }, ALARM_FADE_DURATION / 10);
};

const switchMode = async () => {
    clearInterval(intervalId);
    isRunning = false;
    startPauseBtn.textContent = '▶ Bắt Đầu';
    
    // 1. Tạm dừng nhạc
    let wasPlaying = false;
    if (player && player.getPlayerState() === 1) { 
        wasPlaying = true;
        currentVolume = player.getVolume() / 100;
        player.pauseVideo();
    }
    
    // 2. Thông báo và phát âm thanh
    if (Notification.permission === 'granted') {
      new Notification(`Hết giờ ${currentMode === 'study' ? 'HỌC' : 'NGHỈ'}!`);
    }
    
    await alarmSound.load(); 
    fadeAlarm(true, () => {
        // Sau khi âm thanh thông báo xong (giả sử 3 giây, tùy thuộc file alarm.mp3)
        setTimeout(() => {
            fadeAlarm(false, () => {
                 // 3. Chuyển mode và cập nhật thời gian
                if (currentMode === 'study') {
                    cycleCount++;
                    if (cycleCount % 4 === 0) {
                        currentMode = 'longBreak';
                        timeLeft = timerSettings.longBreak;
                    } else {
                        currentMode = 'shortBreak';
                        timeLeft = timerSettings.shortBreak;
                    }
                } else {
                    currentMode = 'study';
                    timeLeft = timerSettings.study;
                }
                updateDisplay();
                
                // 4. Tiếp tục phát nhạc
                if (wasPlaying && player) {
                    player.playVideo();
                    player.setVolume(currentVolume * 100);
                }
            });
        }, 3000); 
    });
};

const startTimer = () => {
    if (intervalId) clearInterval(intervalId);
    
    intervalId = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            switchMode();
        } else {
            updateDisplay();
        }
    }, 1000);
};

// Events cho Pomodoro
startPauseBtn.addEventListener('click', () => {
    isRunning = !isRunning;
    if (isRunning) {
        startPauseBtn.textContent = '⏸ Tạm Dừng';
        startTimer();
    } else {
        startPauseBtn.textContent = '▶ Bắt Đầu';
        clearInterval(intervalId);
    }
});

document.getElementById('btn-reset').addEventListener('click', () => {
    clearInterval(intervalId);
    isRunning = false;
    currentMode = 'study';
    timeLeft = timerSettings.study;
    cycleCount = 0;
    startPauseBtn.textContent = '▶ Bắt Đầu';
    updateDisplay();
});

document.querySelectorAll('.settings input').forEach(input => {
    input.addEventListener('change', (e) => {
        const name = e.target.id.replace('setting-', '');
        timerSettings[name] = parseInt(e.target.value || 1) * 60; 
        
        if (!isRunning && name === currentMode) {
            timeLeft = timerSettings[name];
            updateDisplay();
        }
    });
});

if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
    Notification.requestPermission();
}


// =======================================================
//                   4. YOUTUBE PLAYER LOGIC
// =======================================================

window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player('youtube-player', {
        height: '100%',
        width: '100%',
        playerVars: { 'controls': 1, 'autoplay': 1, 'modestbranding': 1 },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
};

const onPlayerReady = (event) => {
    console.log("YouTube Player đã sẵn sàng.");
    document.querySelector('.placeholder').style.display = 'none';

    if (currentPlaylist.length > 0) {
        currentTrackIndex = 0;
        player.loadVideoById(currentPlaylist[currentTrackIndex].videoId);
    }
};

const onPlayerStateChange = (event) => {
    if (event.data === 0) { // ENDED
        playNextTrack();
    }
    if (event.data === 1) { // PLAYING
        currentVolume = player.getVolume() / 100; 
    }
};

const playVideoAtIndex = (index) => {
    if (currentPlaylist.length === 0 || !player) return; // FIX: Kiểm tra player
    currentTrackIndex = index;
    player.loadVideoById(currentPlaylist[currentTrackIndex].videoId);
    renderPlaylist(); 
};

const playNextTrack = () => {
    if (currentPlaylist.length === 0 || !player) return; // FIX: Kiểm tra player
    const nextIndex = (currentTrackIndex + 1) % currentPlaylist.length;
    playVideoAtIndex(nextIndex);
};

const playPrevTrack = () => {
    if (currentPlaylist.length === 0 || !player) return; // FIX: Kiểm tra player
    const prevIndex = (currentTrackIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
    playVideoAtIndex(prevIndex);
};

const togglePlayback = () => {
    if (!player) return;
    const state = player.getPlayerState();
    if (state === 1) {
        player.pauseVideo();
    } else if (state === 2 || state === 5) {
        player.playVideo();
    } else if (state === -1 && currentPlaylist.length > 0) {
        playVideoAtIndex(currentTrackIndex !== -1 ? currentTrackIndex : 0);
    }
};

document.getElementById('btn-next').addEventListener('click', playNextTrack);
document.getElementById('btn-prev').addEventListener('click', playPrevTrack);
document.getElementById('btn-play-pause').addEventListener('click', togglePlayback);


// =======================================================
//                   5. PLAYLIST MANAGER & DRAG & DROP
// =======================================================

// Xử lý thêm bài hát
document.getElementById('btn-add-song').addEventListener('click', async () => {
    const url = urlInputEl.value.trim();
    const videoId = getYouTubeVideoId(url);
    errorEl.textContent = ''; 

    if (!videoId) {
        errorEl.textContent = '❌ URL YouTube không hợp lệ.';
        return;
    }
    
    // FIX: Kiểm tra trùng videoID
    const isDuplicate = currentPlaylist.some(song => song.videoId === videoId);
    if (isDuplicate) {
        errorEl.textContent = '⚠️ Video này đã có trong Playlist.';
        return;
    }

    // Lấy tiêu đề video (Async)
    const title = await fetchVideoTitle(videoId);

    const newSong = {
        id: Date.now(),
        videoId: videoId,
        title: title,
    };

    const wasEmpty = currentPlaylist.length === 0;
    
    currentPlaylist.push(newSong);
    savePlaylist();
    urlInputEl.value = '';

    // FIX: Nếu là bài đầu tiên, tự động phát
    if (wasEmpty && player) {
        playVideoAtIndex(0); 
    }
});

// Xử lý render danh sách (bao gồm logic kéo thả)
const renderPlaylist = () => {
    playlistListEl.innerHTML = ''; 
    
    if (currentPlaylist.length === 0) {
        playlistListEl.innerHTML = '<li style="text-align:center; color:#9ca3af; padding: 15px;">Playlist rỗng. Hãy thêm nhạc!</li>';
        return;
    }

    currentPlaylist.forEach((song, index) => {
        const li = document.createElement('li');
        li.setAttribute('draggable', 'true');
        li.dataset.id = song.id;

        li.innerHTML = `
            <span>${song.title}</span>
            <button data-id="${song.id}">Xóa</button>
        `;
        
        // Đánh dấu bài đang phát
        if (index === currentTrackIndex) {
            li.classList.add('current-track');
        }
        
        // Click để phát bài này
        li.querySelector('span').addEventListener('click', () => {
            if (player) {
                playVideoAtIndex(index);
            }
        });
        
        // Nút xóa
        li.querySelector('button').addEventListener('click', (e) => {
            e.stopPropagation(); 
            const idToRemove = parseInt(e.target.dataset.id);
            currentPlaylist = currentPlaylist.filter(s => s.id !== idToRemove);
            savePlaylist();
            
            if (index === currentTrackIndex) {
                 playNextTrack(); 
            }
        });

        // Logic kéo thả (Drag & Drop)
        li.addEventListener('dragstart', handleDragStart);
        li.addEventListener('dragover', handleDragOver);
        li.addEventListener('drop', handleDrop);
        li.addEventListener('dragleave', handleDragLeave);
        li.addEventListener('dragend', handleDragEnd);

        playlistListEl.appendChild(li);
    });
};

let draggingItem = null;

function handleDragStart(e) {
    draggingItem = this;
    setTimeout(() => this.classList.add('dragging'), 0);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.id);
}

function handleDragEnd() {
    this.classList.remove('dragging');
    this.classList.remove('drag-over');
    draggingItem = null;
    savePlaylist();
}

function handleDragOver(e) {
    e.preventDefault(); 
    if (draggingItem && draggingItem !== this) {
        this.classList.add('drag-over');
        e.dataTransfer.dropEffect = 'move';
    }
}

function handleDragLeave() {
    this.classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    this.classList.remove('drag-over');

    if (draggingItem && draggingItem !== this) {
        const draggedId = parseInt(draggingItem.dataset.id);
        const droppedId = parseInt(this.dataset.id);
        
        const draggedIndex = currentPlaylist.findIndex(song => song.id === draggedId);
        const droppedIndex = currentPlaylist.findIndex(song => song.id === droppedId);

        // Di chuyển item trong mảng
        const [movedItem] = currentPlaylist.splice(draggedIndex, 1);
        currentPlaylist.splice(droppedIndex, 0, movedItem);

        // Cập nhật lại index bài đang phát
        if (currentTrackIndex === draggedIndex) {
            currentTrackIndex = droppedIndex;
        } else if (currentTrackIndex > draggedIndex && currentTrackIndex <= droppedIndex) {
            currentTrackIndex--;
        } else if (currentTrackIndex < draggedIndex && currentTrackIndex >= droppedIndex) {
            currentTrackIndex++;
        }

        renderPlaylist();
    }
}

// =======================================================
//                   INIT
// =======================================================

const init = () => {
    loadPlaylist();
    renderPlaylist();
    updateDisplay();
};

window.onload = init;
