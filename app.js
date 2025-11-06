// =======================================================
//                   GLOBAL STATE & INIT
// =======================================================

const STORAGE_KEY = 'study_playlist_simple';
const YOUTUBE_OEMBED_API = 'https://www.youtube.com/oembed?url=';
const ALARM_FADE_DURATION = 1000; 

let player; 
let currentPlaylist = [];
let currentTrackIndex = -1;
let intervalId = null;
let currentVolume = 0.5; 

const timerSettings = {
    study: 25 * 60, // Sẽ được tính lại từ input Giờ/Phút
    shortBreak: 5 * 60,
    longBreak: 15 * 60,
    totalCycles: 4, // Mặc định 4 chu kỳ
};

let currentMode = 'study';
let timeLeft = timerSettings.study;
let isRunning = false;
let cycleCount = 0; // Số lần hoàn thành chu kỳ Học

// Elements
const playlistListEl = document.getElementById('playlist-list');
const urlInputEl = document.getElementById('youtube-url');
const errorEl = document.getElementById('playlist-error');
const timerDisplayEl = document.getElementById('countdown');
const timerModeEl = document.getElementById('timer-mode');
const cycleInfoEl = document.getElementById('cycle-info');
const startPauseBtn = document.getElementById('btn-start-pause');
const skipBtn = document.getElementById('btn-skip'); 
const alarmSound = document.getElementById('alarm-sound');
const timerCardEl = document.getElementById('timer-section');

// Icons
const playPauseIcon = document.querySelector('#btn-play-pause i');


// =======================================================
//                   HELPER FUNCTIONS
// =======================================================

const getYouTubeVideoId = (url) => {
    const regex = /(?:youtu\.be\/|v\/|watch\?v=|embed\/)([^&"'>]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
};

const fetchVideoTitle = async (videoId) => {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    try {
        // Sử dụng một proxy để tránh lỗi CORS khi gọi trực tiếp API Oembed
        // Lưu ý: Nếu môi trường chạy chặn gọi bên ngoài, phần này vẫn có thể lỗi.
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
    timerModeEl.textContent = currentMode === 'study' ? 'TẬP TRUNG HỌC' : 
                               (currentMode === 'shortBreak' ? 'NGHỈ NGẮN' : 'NGHỈ DÀI');
    timerModeEl.className = currentMode === 'study' ? 'study-mode' : 'break-mode';
    timerCardEl.style.backgroundColor = currentMode === 'study' ? 'rgba(255, 99, 71, 0.1)' : 'rgba(60, 179, 113, 0.1)';
    
    // Cập nhật chu kỳ hiện tại / tổng chu kỳ
    const totalCycles = parseInt(document.getElementById('setting-total-cycles').value || 4);
    timerSettings.totalCycles = totalCycles;
    const currentCycle = cycleCount % totalCycles;
    cycleInfoEl.textContent = `Chu kỳ: ${currentCycle === 0 ? totalCycles : currentCycle} / ${totalCycles}`;
    
    document.title = `${formatTime(timeLeft)} - ${timerModeEl.textContent}`;
};

const fadeAlarm = (isFadeIn, callback) => {
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

const switchMode = async (autoStartNext = true) => {
    clearInterval(intervalId);
    isRunning = false;
    startPauseBtn.textContent = '▶ Bắt Đầu';
    
    // 1. Tạm dừng nhạc và lưu âm lượng
    let wasPlaying = false;
    if (player && player.getPlayerState() === 1) { 
        wasPlaying = true;
        currentVolume = player.getVolume() / 100;
        player.pauseVideo();
        playPauseIcon.classList.remove('fa-pause');
        playPauseIcon.classList.add('fa-play');
    }
    
    // 2. Thông báo và phát âm thanh
    if (Notification.permission === 'granted') {
      new Notification(`Hết giờ ${currentMode === 'study' ? 'HỌC' : 'NGHỈ'}!`);
    }
    
    await alarmSound.load(); 
    fadeAlarm(true, () => {
        // Sau khi âm thanh thông báo xong
        setTimeout(() => {
            fadeAlarm(false, () => {
                 // 3. Chuyển mode và cập nhật thời gian
                const totalCycles = timerSettings.totalCycles;
                
                if (currentMode === 'study') {
                    cycleCount++;
                    if (cycleCount > totalCycles) {
                        currentMode = 'study';
                        timeLeft = timerSettings.study;
                        cycleCount = 0;
                        updateDisplay();
                        return; 
                    } else if (cycleCount % totalCycles === 0 && totalCycles > 0) {
                        currentMode = 'longBreak';
                        timeLeft = timerSettings.longBreak;
                    } else {
                        currentMode = 'shortBreak';
                        timeLeft = timerSettings.shortBreak;
                    }
                } else { // Đang ở chế độ Nghỉ
                    currentMode = 'study';
                    timeLeft = timerSettings.study;
                }
                
                updateDisplay();
                
                // 4. Tự động bắt đầu đếm ngược cho chế độ tiếp theo
                if (autoStartNext) {
                    isRunning = true;
                    startPauseBtn.textContent = '⏸ Tạm Dừng';
                    startTimer();
                    
                    // 5. Tiếp tục phát nhạc
                    if (wasPlaying && player) {
                        player.playVideo();
                        player.setVolume(currentVolume * 100);
                        playPauseIcon.classList.remove('fa-play');
                        playPauseIcon.classList.add('fa-pause');
                    }
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
            switchMode(true); 
        } else {
            updateDisplay();
        }
    }, 1000);
};

// Hàm tính toán thời gian học từ Giờ và Phút
const updateStudyTimeSetting = () => {
    const hours = parseInt(document.getElementById('setting-study-hour').value || 0);
    const minutes = parseInt(document.getElementById('setting-study-minute').value || 0);
    
    const totalSeconds = (hours * 3600) + (minutes * 60);
    // Đảm bảo tối thiểu là 1 phút nếu người dùng không nhập gì
    timerSettings.study = Math.max(60, totalSeconds); 
    
    if (!isRunning && currentMode === 'study') {
        timeLeft = timerSettings.study;
        updateDisplay();
    }
};


// Events cho Pomodoro
startPauseBtn.addEventListener('click', () => {
    // Đảm bảo thời gian học đã được cập nhật trước khi bắt đầu
    if (currentMode === 'study') {
        updateStudyTimeSetting(); 
    }
    
    isRunning = !isRunning;
    if (isRunning) {
        startPauseBtn.textContent = '⏸ Tạm Dừng';
        startTimer();
    } else {
        startPauseBtn.textContent = '▶ Bắt Đầu';
        clearInterval(intervalId);
    }
});

skipBtn.addEventListener('click', () => {
    if (isRunning || timeLeft > 0) {
        switchMode(true); 
    }
});


document.getElementById('btn-reset').addEventListener('click', () => {
    clearInterval(intervalId);
    isRunning = false;
    currentMode = 'study';
    updateStudyTimeSetting(); 
    cycleCount = 0;
    startPauseBtn.textContent = '▶ Bắt Đầu';
    updateDisplay();
});

// Event cho cài đặt Giờ/Phút và Chu kỳ
document.querySelectorAll('.settings-group input').forEach(input => { 
    input.addEventListener('change', (e) => {
        if (e.target.id === 'setting-study-hour' || e.target.id === 'setting-study-minute') {
            updateStudyTimeSetting();
        } else if (e.target.id === 'setting-total-cycles') {
            timerSettings.totalCycles = parseInt(e.target.value || 1);
            updateDisplay();
        } else {
            const name = e.target.id.replace('setting-', '');
            timerSettings[name] = parseInt(e.target.value || 1) * 60; 
            
            if (!isRunning && currentMode.toLowerCase().includes(name.toLowerCase())) { 
                timeLeft = timerSettings[name];
                updateDisplay();
            }
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
        playerVars: { 'controls': 1, 'autoplay': 0, 'modestbranding': 1 },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
};

const onPlayerReady = (event) => {
    console.log("YouTube Player đã sẵn sàng.");
    
    const placeholderEl = document.getElementById('player-placeholder');
    if (placeholderEl) {
        placeholderEl.style.display = 'none';
    }
    
    playPauseIcon.classList.add('fa-play');

    if (currentPlaylist.length > 0 && currentTrackIndex === -1) {
        currentTrackIndex = 0;
        // Sử dụng cueVideoById để tải video mà không cố gắng phát (tránh lỗi)
        player.cueVideoById(currentPlaylist[currentTrackIndex].videoId); 
        renderPlaylist(); 
    }
};

const onPlayerStateChange = (event) => {
    if (event.data === 0) { // ENDED
        playNextTrack();
    }
    if (event.data === 1) { // PLAYING
        currentVolume = player.getVolume() / 100; 
        playPauseIcon.classList.remove('fa-play');
        playPauseIcon.classList.add('fa-pause');
    }
    if (event.data === 2) { // PAUSED
        playPauseIcon.classList.remove('fa-pause');
        playPauseIcon.classList.add('fa-play');
    }
};

// FIX LỖI PLAY KHÔNG CHẠY KHI CLICK
const playVideoAtIndex = (index, forcePlay = true) => {
    if (currentPlaylist.length === 0 || !player || !player.loadVideoById) return; 
    
    const videoId = currentPlaylist[index].videoId;
    currentTrackIndex = index;

    player.loadVideoById({
        videoId: videoId,
        startSeconds: 0,
        suggestedQuality: 'small',
        autoplay: 0 
    }); 
    
    if (forcePlay) {
         // Thử gọi playVideo() sau một khoảng trễ ngắn để đảm bảo video đã được tải 
         // và cố gắng vượt qua cơ chế chặn autoplay của trình duyệt.
         setTimeout(() => {
             player.playVideo().catch(e => console.error("Lỗi khi cố gắng play video:", e)); 
         }, 500);
    }
    
    renderPlaylist(); 
};

const playNextTrack = () => {
    if (currentPlaylist.length === 0 || !player) return; 
    const nextIndex = (currentTrackIndex + 1) % currentPlaylist.length;
    playVideoAtIndex(nextIndex);
};

const playPrevTrack = () => {
    if (currentPlaylist.length === 0 || !player) return; 
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
        // Nếu player chưa load gì (state -1) và có playlist, thì load video đầu tiên (hoặc video hiện tại)
        playVideoAtIndex(currentTrackIndex !== -1 ? currentTrackIndex : 0);
    }
};

document.getElementById('btn-next').addEventListener('click', playNextTrack);
document.getElementById('btn-prev').addEventListener('click', playPrevTrack);
document.getElementById('btn-play-pause').addEventListener('click', togglePlayback);


// =======================================================
//                   5. PLAYLIST MANAGER & DRAG & DROP
// =======================================================

document.getElementById('btn-add-song').addEventListener('click', async () => {
    const url = urlInputEl.value.trim();
    const videoId = getYouTubeVideoId(url);
    errorEl.textContent = ''; 

    if (!videoId) {
        errorEl.textContent = '❌ URL YouTube không hợp lệ.';
        return;
    }
    
    const isDuplicate = currentPlaylist.some(song => song.videoId === videoId);
    if (isDuplicate) {
        errorEl.textContent = '⚠️ Video này đã có trong Playlist.';
        return;
    }

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

    if (wasEmpty && player) {
        // Tự động play khi thêm bài đầu tiên
        playVideoAtIndex(0); 
    }
});


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
            <button data-id="${song.id}"><i class="fas fa-trash-alt"></i></button>
        `;
        
        if (index === currentTrackIndex) {
            li.classList.add('current-track');
        }
        
        // SỬA LỖI CLICK: Gọi hàm playVideoAtIndex
        li.querySelector('span').addEventListener('click', () => {
            if (player) {
                playVideoAtIndex(index, true); 
            }
        });
        
        li.querySelector('button').addEventListener('click', (e) => {
            e.stopPropagation(); 
            const idToRemove = parseInt(e.target.closest('button').dataset.id); 
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

        const [movedItem] = currentPlaylist.splice(draggedIndex, 1);
        currentPlaylist.splice(droppedIndex, 0, movedItem);

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
    updateStudyTimeSetting(); 
    renderPlaylist();
    updateDisplay();
};

window.onload = init;
