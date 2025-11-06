// =======================================================
//                   1. YOUTUBE PLAYER LOGIC
// =======================================================

const STORAGE_KEY = 'study_playlist_simple';
let player; // Biến toàn cục để lưu trữ đối tượng YouTube Player
let currentPlaylist = [];
let currentTrackIndex = -1;

// Helper: Trích xuất Video ID từ URL YouTube
const getYouTubeVideoId = (url) => {
    const regex = /(?:youtu\.be\/|v\/|watch\?v=|embed\/)([^&"'>]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
};

// Hàm tải playlist từ Local Storage
const loadPlaylist = () => {
    const data = localStorage.getItem(STORAGE_KEY);
    currentPlaylist = data ? JSON.parse(data) : [];
};

// Hàm lưu playlist vào Local Storage
const savePlaylist = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentPlaylist));
    renderPlaylist();
};

// Hàm khởi tạo Player sau khi YouTube API sẵn sàng (yêu cầu file index.html nhúng API)
window.onYouTubeIframeAPIReady = () => {
    // Tạo iframe player tại element có ID 'youtube-player'
    player = new YT.Player('youtube-player', {
        height: '100%',
        width: '100%',
        playerVars: {
            'controls': 1,
            'autoplay': 1,
            'modestbranding': 1
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
};

const onPlayerReady = (event) => {
    console.log("YouTube Player đã sẵn sàng.");
    if (currentPlaylist.length > 0) {
        currentTrackIndex = 0;
        player.loadVideoById(currentPlaylist[currentTrackIndex].videoId);
    }
};

const onPlayerStateChange = (event) => {
    // State 0 là ENDED (kết thúc)
    if (event.data === 0) {
        playNextTrack();
    }
};

// Logic chuyển bài tiếp theo
const playNextTrack = () => {
    if (currentPlaylist.length === 0) return;
    currentTrackIndex = (currentTrackIndex + 1) % currentPlaylist.length;
    player.loadVideoById(currentPlaylist[currentTrackIndex].videoId);
};

// Logic chuyển bài trước đó
const playPrevTrack = () => {
    if (currentPlaylist.length === 0) return;
    currentTrackIndex = (currentTrackIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
    player.loadVideoById(currentPlaylist[currentTrackIndex].videoId);
};

// Logic Play/Pause
const togglePlayback = () => {
    if (!player) return;
    const state = player.getPlayerState();
    // 1: Playing, 2: Paused
    if (state === 1) {
        player.pauseVideo();
    } else if (state === 2 || state === 5) { // 5: Video cued (chưa phát)
        player.playVideo();
    }
};

// =======================================================
//                   2. PLAYLIST MANAGER LOGIC
// =======================================================

const playlistListEl = document.getElementById('playlist-list');
const urlInputEl = document.getElementById('youtube-url');
const errorEl = document.getElementById('playlist-error');

// Xử lý thêm bài hát
document.getElementById('btn-add-song').addEventListener('click', () => {
    const url = urlInputEl.value.trim();
    const videoId = getYouTubeVideoId(url);
    errorEl.textContent = ''; // Xóa thông báo lỗi cũ

    if (!videoId) {
        errorEl.textContent = '❌ URL YouTube không hợp lệ.';
        return;
    }

    const newSong = {
        id: Date.now(),
        videoId: videoId,
        title: `YouTube Video: ${videoId}`,
    };

    currentPlaylist.push(newSong);
    savePlaylist();
    urlInputEl.value = '';

    // Nếu là bài đầu tiên được thêm, tự động phát
    if (currentPlaylist.length === 1 && player) {
        currentTrackIndex = 0;
        player.loadVideoById(videoId);
    }
});

// Xử lý render danh sách
const renderPlaylist = () => {
    playlistListEl.innerHTML = ''; // Xóa danh sách cũ
    if (currentPlaylist.length === 0) {
        playlistListEl.innerHTML = '<li style="text-align:center; color:#9ca3af; padding: 15px;">Playlist rỗng. Hãy thêm nhạc!</li>';
        return;
    }

    currentPlaylist.forEach((song, index) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${song.title}</span>
            <button data-id="${song.id}">Xóa</button>
        `;
        // Click để phát bài này
        li.querySelector('span').addEventListener('click', () => {
            if (player) {
                currentTrackIndex = index;
                player.loadVideoById(song.videoId);
            }
        });
        
        // Nút xóa
        li.querySelector('button').addEventListener('click', (e) => {
            e.stopPropagation(); // Ngăn chặn sự kiện click lan truyền lên <li>
            const idToRemove = parseInt(e.target.dataset.id);
            currentPlaylist = currentPlaylist.filter(s => s.id !== idToRemove);
            savePlaylist();
            // Nếu xóa bài đang phát, chuyển sang bài tiếp theo
            if (index === currentTrackIndex) {
                 playNextTrack();
            }
        });

        playlistListEl.appendChild(li);
    });
};

// Gắn các sự kiện điều khiển Player
document.getElementById('btn-next').addEventListener('click', playNextTrack);
document.getElementById('btn-prev').addEventListener('click', playPrevTrack);
document.getElementById('btn-play-pause').addEventListener('click', togglePlayback);

// =======================================================
//                   3. POMODORO TIMER LOGIC
// =======================================================

const timerDisplayEl = document.getElementById('countdown');
const timerModeEl = document.getElementById('timer-mode');
const cycleInfoEl = document.getElementById('cycle-info');
const startPauseBtn = document.getElementById('btn-start-pause');
const alarmSound = document.getElementById('alarm-sound');

const timerSettings = {
    study: 25 * 60,
    shortBreak: 5 * 60,
    longBreak: 15 * 60,
};

let currentMode = 'study'; // 'study', 'shortBreak', 'longBreak'
let timeLeft = timerSettings.study;
let isRunning = false;
let intervalId = null;
let cycleCount = 0;

// Helper: Định dạng thời gian
const formatTime = (time) => {
    const minutes = Math.floor(time / 60).toString().padStart(2, '0');
    const seconds = (time % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
};

// Cập nhật giao diện
const updateDisplay = () => {
    timerDisplayEl.textContent = formatTime(timeLeft);
    timerModeEl.textContent = currentMode === 'study' ? 'TẬP TRUNG HỌC' : 'THỜI GIAN NGHỈ';
    timerModeEl.className = currentMode === 'study' ? 'study-mode' : 'break-mode';
    cycleInfoEl.textContent = `Chu kỳ: ${cycleCount % 4} / 4`;
    document.title = `${formatTime(timeLeft)} - ${timerModeEl.textContent}`;
};

// Xử lý chuyển đổi mode
const switchMode = () => {
    // Thông báo và âm thanh
    alarmSound.play();
    if (Notification.permission === 'granted') {
      new Notification(`Hết giờ ${currentMode === 'study' ? 'HỌC' : 'NGHỈ'}!`);
    }

    // Chuyển mode
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
    
    // Đảm bảo đồng hồ dừng lại
    isRunning = false; 
    startPauseBtn.textContent = '▶ Bắt Đầu';
    updateDisplay();
};


// Logic đếm ngược chính
const startTimer = () => {
    if (intervalId) clearInterval(intervalId);
    
    intervalId = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            clearInterval(intervalId);
            switchMode();
        } else {
            updateDisplay();
        }
    }, 1000);
};

// Xử lý nút Bắt Đầu/Tạm Dừng
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

// Xử lý nút Đặt Lại
document.getElementById('btn-reset').addEventListener('click', () => {
    clearInterval(intervalId);
    isRunning = false;
    currentMode = 'study';
    timeLeft = timerSettings.study;
    cycleCount = 0;
    startPauseBtn.textContent = '▶ Bắt Đầu';
    updateDisplay();
});

// Xử lý thay đổi cài đặt
document.querySelectorAll('.settings input').forEach(input => {
    input.addEventListener('change', (e) => {
        const name = e.target.id.replace('setting-', '');
        // Chuyển phút thành giây
        timerSettings[name] = parseInt(e.target.value || 1) * 60; 
        
        // Cập nhật lại thời gian hiện tại nếu không chạy
        if (!isRunning && name === currentMode) {
            timeLeft = timerSettings[name];
            updateDisplay();
        }
    });
});

// Yêu cầu quyền thông báo
if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
    Notification.requestPermission();
}

// =======================================================
//                   4. KHỞI TẠO
// =======================================================

const init = () => {
    loadPlaylist();
    renderPlaylist();
    updateDisplay();
};

window.onload = init;