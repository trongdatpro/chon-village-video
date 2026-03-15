const fetchJSONP = (url) => new Promise((resolve) => {
    const cbName = 'gvizCb_' + Date.now() + Math.floor(Math.random() * 10000);
    const s = document.createElement('script');
    const timeout = setTimeout(() => {
        delete window[cbName];
        if (s.parentNode) document.head.removeChild(s);
        resolve(null);
    }, 10000);
    window[cbName] = (res) => {
        clearTimeout(timeout);
        delete window[cbName];
        if (s.parentNode) document.head.removeChild(s);
        resolve(res);
    };
    s.src = url + (url.includes('?') ? '&' : '?') + 'tqx=out:json;responseHandler:' + cbName;
    document.head.appendChild(s);
});

const renderCurrency = (val) => {
    if (val === undefined || val === null || isNaN(val)) return "0";
    return val.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

const isBooked = (s) => {
    if (!s) return false;
    // Normalize both Unicode and whitespace
    const clean = String(s).normalize('NFC').trim().toLowerCase();
    // Common indicators for a booked/unavailable room
    return clean === 'booked' || clean === 'đã đặt' || clean === 'b' || clean.includes('đã đặt') || clean.includes('đặt');
};

const convertGDriveUrl = (url, isVideo = false, highRes = false, customSize = null) => {
    if (!url) return "";
    let fileId = "";

    // --- YouTube Support ---
    const ytMatch = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
    if (ytMatch && ytMatch[1]) {
        const ytId = ytMatch[1];
        if (isVideo) {
            return `https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0`;
        }
        // YouTube thumbnail
        return `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
    }

    // --- Cloudinary Support ---
    if (url.includes('cloudinary.com')) {
        if (isVideo) return url;

        let trans = customSize || (highRes ? "w_1600" : "w_800");
        // Normalize size param (e.g., w1600 -> w_1600)
        if (typeof trans === 'string' && trans.startsWith('w') && !trans.includes('_')) {
            trans = 'w_' + trans.substring(1);
        }

        const finalTrans = `f_jpg,so_2,q_auto,${trans}`;

        // Inject transformations right after /upload/
        // We do NOT capture the version string here to avoid breaking the URL
        return url.replace(/\/upload\//, `/upload/${finalTrans}/`)
            .replace(/\.(mp4|webm|mov|m4v|ogv)(\?.*)?$/i, '.jpg$2');
    }

    // --- Google Drive Support ---
    const idMatches = url.match(/\/d\/(.+?)\//) ||
        url.match(/\/d\/(.+?)$/) ||
        url.match(/id=(.+?)(&|$)/);

    if (idMatches && idMatches[1]) {
        fileId = idMatches[1].split(/[?&]/)[0];
    }

    if (fileId) {
        if (isVideo) {
            // Attempt to force quality and autoplay for GDrive preview
            const baseUrl = `https://drive.google.com/file/d/${fileId}/preview`;
            return baseUrl + "?vq=hd720&autoplay=1";
        }
        // customSize > highRes > default
        let sizeParam = customSize || (highRes ? "w1600" : "w2048");
        return `https://drive.google.com/thumbnail?id=${fileId}&sz=${sizeParam}`;
    }
    return url;
};

// --- GLOBAL GALLERY STATE ---
window.galleryData = {};
let currentGallery = [];
let currentGalleryIndex = 0;

document.addEventListener('DOMContentLoaded', async () => {
    // Mini UI Logger
    const debugEl = document.getElementById('debug-console');
    const logs = [];
    const uiLog = (...args) => {
        if (!debugEl) return;
        logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
        debugEl.innerHTML = logs.slice(-10).join('<br/>');
    };
    uiLog("Init Room Script...");

    const summaryBar = document.getElementById('summary-bar');
    const changeDateBtn = document.getElementById('change-date-btn');
    const headerTitle = document.getElementById('header-title');
    const headerChangeDateBtn = document.getElementById('header-change-date-btn');

    // 1. Check Session Storage
    const bookingDataStr = sessionStorage.getItem('chonVillageBooking');
    if (!bookingDataStr) {
        window.location.href = 'index.html';
        return;
    }

    const bookingData = JSON.parse(bookingDataStr);

    // Parse dates reliably in local time
    const parseLocal = (dateStr) => {
        const [y, m, d] = dateStr.split('-');
        return new Date(y, m - 1, d);
    };

    const checkinDate = parseLocal(bookingData.checkin);
    const checkoutDate = parseLocal(bookingData.checkout);

    const adults = parseInt(bookingData.adults) || 2;
    const children = parseInt(bookingData.children) || 0;
    const childrenAgesStr = bookingData.childrenAgeCategory || "";
    const childrenAges = childrenAgesStr ? childrenAgesStr.split(',').map(a => parseInt(a)) : [];
    const isUnder6 = childrenAges.some(age => age > 0 && age < 6);

    // Formatting dates for display
    const formatDateObj = (d) => `${d.getDate()}/${d.getMonth() + 1}`;
    document.getElementById('summary-dates').textContent = `${formatDateObj(checkinDate)} - ${formatDateObj(checkoutDate)}`;

    let summaryGuestsStr = `${adults} Người lớn`;
    if (children > 0) summaryGuestsStr += `, ${children} Trẻ em`;
    document.getElementById('summary-guests').textContent = summaryGuestsStr;

    const roomsContainer = document.getElementById('rooms-container');
    roomsContainer.innerHTML = `
        <div class="flex flex-col items-center justify-center space-y-4 my-16 opacity-0 animate-[fadeIn_1s_ease-out_forwards]">
            <span class="inline-block animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary"></span>
            <p class="text-center text-primary font-display italic text-lg">Chồn is preparing the room...</p>
        </div>
    `;

    // 2. Database Definition
    const localRooms = [
        {
            id: "Pink_Room",
            name: "Pink Room",
            area: "25m²",
            amenities: ["TV 55 inch kết nối Netflix, YouTube,...", "Quạt", "Máy sấy", "Bàn trang điểm", "Giường 1m8", "Toilet riêng có bồn tắm", "Nước suối miễn phí", "Đồ dùng vệ sinh cá nhân", "Bàn ủi hơi nước"],
            special: null,
            img: "https://images.unsplash.com/photo-1518136247453-74e7b5265980?q=80&w=600&auto=format&fit=crop"
        },
        {
            id: "Gray_Room",
            name: "Gray Room",
            area: "25m²",
            amenities: ["TV 55 inch kết nối Netflix, YouTube,...", "Điều hòa", "Máy sấy", "Bàn trang điểm", "Giường 1m8", "Toilet riêng có bồn tắm", "Nước suối miễn phí", "Đồ dùng vệ sinh cá nhân", "Bàn ủi hơi nước"],
            special: null,
            img: "https://images.unsplash.com/photo-1616594039964-ae9021a400a0?q=80&w=600&auto=format&fit=crop"
        },
        {
            id: "Green_Room",
            name: "Green Room",
            area: "25m²",
            amenities: ["TV 55 inch kết nối Netflix, YouTube,...", "Máy lạnh", "Máy sấy", "Bàn trang điểm", "Giường 1m8", "Toilet riêng có bồn tắm", "Nước suối miễn phí", "Đồ dùng vệ sinh cá nhân", "Bàn ủi hơi nước"],
            special: "Lựa chọn lý tưởng cho trẻ dưới 6 tuổi",
            img: "https://plus.unsplash.com/premium_photo-1678297270385-ad5067126607?q=80&w=600&auto=format&fit=crop"
        },
        {
            id: "Black_Room",
            name: "Black Room",
            area: "32m²",
            amenities: ["TV 65 inch kết nối Netflix, YouTube,...", "Máy lạnh", "Máy sấy", "Bàn trang điểm", "Giường 1m8", "Toilet riêng có bồn tắm", "Nước suối miễn phí", "Đồ dùng vệ sinh cá nhân", "Bàn ủi hơi nước"],
            special: null,
            img: "https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?q=80&w=600&auto=format&fit=crop"
        },
        {
            id: "White_Room",
            name: "White Room",
            area: "33m²",
            amenities: ["TV 55 inch kết nối Netflix, YouTube,...", "Máy lạnh", "Máy sấy", "Bàn trang điểm", "Giường 1m8", "Toilet riêng có bồn tắm", "Nước suối miễn phí", "Đồ dùng vệ sinh cá nhân", "Bàn ủi hơi nước"],
            special: null,
            img: "https://images.unsplash.com/photo-1590490360182-c33d57733427?q=80&w=600&auto=format&fit=crop"
        },
        {
            id: "Gold_Room",
            name: "Gold Room",
            area: "33m²",
            amenities: ["Bồn cầu điện", "Sưởi khăn tắm", "TV 55 inch kết nối Netflix, YouTube,...", "Máy lạnh", "Máy sấy", "Bàn trang điểm", "Giường 1m8", "Toilet riêng có bồn tắm", "Nước suối miễn phí", "Đồ dùng vệ sinh cá nhân", "Bàn ủi hơi nước"],
            special: "Có sân vườn, bếp riêng",
            img: "https://images.unsplash.com/photo-1554995207-c18c203602cb?q=80&w=600&auto=format&fit=crop"
        }
    ];

    // 3. Fetch Google Sheets Data
    const URL_PRICINGS = [
        'https://docs.google.com/spreadsheets/d/1XluSzDsFCMCbgQHDjJTF7_mX7D4isUI9QbtwVCQXCbY/gviz/tq?gid=2054490170',
        'https://docs.google.com/spreadsheets/d/1XluSzDsFCMCbgQHDjJTF7_mX7D4isUI9QbtwVCQXCbY/gviz/tq?gid=1006162975',
        'https://docs.google.com/spreadsheets/d/1XluSzDsFCMCbgQHDjJTF7_mX7D4isUI9QbtwVCQXCbY/gviz/tq?gid=583502511', // T5
        'https://docs.google.com/spreadsheets/d/1XluSzDsFCMCbgQHDjJTF7_mX7D4isUI9QbtwVCQXCbY/gviz/tq?gid=1084259420', // T6
        'https://docs.google.com/spreadsheets/d/1XluSzDsFCMCbgQHDjJTF7_mX7D4isUI9QbtwVCQXCbY/gviz/tq?gid=1502542719', // T7
        'https://docs.google.com/spreadsheets/d/1XluSzDsFCMCbgQHDjJTF7_mX7D4isUI9QbtwVCQXCbY/gviz/tq?gid=1606229783', // T8
        'https://docs.google.com/spreadsheets/d/1XluSzDsFCMCbgQHDjJTF7_mX7D4isUI9QbtwVCQXCbY/gviz/tq?gid=489054922',  // T9
        'https://docs.google.com/spreadsheets/d/1XluSzDsFCMCbgQHDjJTF7_mX7D4isUI9QbtwVCQXCbY/gviz/tq?gid=616215486',  // T10
        'https://docs.google.com/spreadsheets/d/1XluSzDsFCMCbgQHDjJTF7_mX7D4isUI9QbtwVCQXCbY/gviz/tq?gid=222250592',  // T11
        'https://docs.google.com/spreadsheets/d/1XluSzDsFCMCbgQHDjJTF7_mX7D4isUI9QbtwVCQXCbY/gviz/tq?gid=1120714568'  // T12
    ];
    const URL_SCHEDULES = [
        'https://docs.google.com/spreadsheets/d/1A-DGSU4oPx74xdzloBQW4ekyhcjATwgh6dKf0Ky0XKg/gviz/tq?gid=1441677072',
        'https://docs.google.com/spreadsheets/d/1A-DGSU4oPx74xdzloBQW4ekyhcjATwgh6dKf0Ky0XKg/gviz/tq?gid=2011761073',
        'https://docs.google.com/spreadsheets/d/1A-DGSU4oPx74xdzloBQW4ekyhcjATwgh6dKf0Ky0XKg/gviz/tq?gid=1564983873', // T5
        'https://docs.google.com/spreadsheets/d/1A-DGSU4oPx74xdzloBQW4ekyhcjATwgh6dKf0Ky0XKg/gviz/tq?gid=1882992325', // T6
        'https://docs.google.com/spreadsheets/d/1A-DGSU4oPx74xdzloBQW4ekyhcjATwgh6dKf0Ky0XKg/gviz/tq?gid=682502335',  // T7
        'https://docs.google.com/spreadsheets/d/1A-DGSU4oPx74xdzloBQW4ekyhcjATwgh6dKf0Ky0XKg/gviz/tq?gid=926390804',  // T8
        'https://docs.google.com/spreadsheets/d/1A-DGSU4oPx74xdzloBQW4ekyhcjATwgh6dKf0Ky0XKg/gviz/tq?gid=382926038',  // T9
        'https://docs.google.com/spreadsheets/d/1A-DGSU4oPx74xdzloBQW4ekyhcjATwgh6dKf0Ky0XKg/gviz/tq?gid=1549710105', // T10
        'https://docs.google.com/spreadsheets/d/1A-DGSU4oPx74xdzloBQW4ekyhcjATwgh6dKf0Ky0XKg/gviz/tq?gid=654600068',  // T11
        'https://docs.google.com/spreadsheets/d/1A-DGSU4oPx74xdzloBQW4ekyhcjATwgh6dKf0Ky0XKg/gviz/tq?gid=1543178625'  // T12
    ];
    const POLICY_API = "https://docs.google.com/spreadsheets/d/1jszKQ6uZOqk-MD0vy--9NqISDuUDau6-gyx-KO1wck4/gviz/tq?gid=1382126270";
    const GALLERY_API = "https://docs.google.com/spreadsheets/d/1jszKQ6uZOqk-MD0vy--9NqISDuUDau6-gyx-KO1wck4/gviz/tq?gid=932135485";
    let dynamicPolicyData = [];
    let scheduleData = {};
    let pricingData = {};
    let isCheckingPolicy = false;

    // Gallery State
    window.galleryData = {};
    let currentGallery = [];
    let currentGalleryIndex = 0;
    let currentRoomId = null;

    try {

        async function syncPolicy() {
            try {
                const res = await fetchJSONP(POLICY_API + "&t=" + Date.now());
                if (res && res.table && res.table.rows) {
                    dynamicPolicyData = res.table.rows.map(row => ({
                        Month_ID: row.c[0] ? row.c[0].v : null,
                        Min_Days_Lead: row.c[1] ? row.c[1].v : null
                    })).filter(p => p.Month_ID !== null);
                    console.log("[V4.2-REALTIME] Policy synced from Sheet:", dynamicPolicyData);
                }
            } catch (e) {
                console.warn("Policy sync failed:", e);
            }
        }

        const pricingPromises = URL_PRICINGS.map(url => fetchJSONP(url));
        const schedulePromises = URL_SCHEDULES.map(url => fetchJSONP(url));

        const allResponses = await Promise.all([
            ...pricingPromises,
            ...schedulePromises,
            fetchJSONP(GALLERY_API + "&t=" + Date.now())
        ]);

        const numPricing = URL_PRICINGS.length;
        const numSchedule = URL_SCHEDULES.length;
        const pricingResponses = allResponses.slice(0, numPricing);
        const scheduleResponses = allResponses.slice(numPricing, numPricing + numSchedule);
        const galleryRes = allResponses[numPricing + numSchedule];
        // Synchronize Policy first
        await syncPolicy();

        // Check if AT LEAST ONE of the links succeeded for both Pricing and Schedule
        const validPricing = pricingResponses.filter(res => res && res.table);
        const validSchedule = scheduleResponses.filter(res => res && res.table);

        if (validSchedule.length === 0) {
            throw new Error("Proxy returned invalid HTML or no data instead of JSONP for Schedule links");
        }

        // Parse Pricing and Schedule
        console.log("Pricing JSONs received", pricingResponses);
        console.log("Schedule JSONs received", scheduleResponses);

        // 4. Parse Gallery Data
        window.galleryData = {};
        if (galleryRes && galleryRes.table && galleryRes.table.rows) {
            galleryRes.table.rows.forEach(row => {
                if (!row.c) return;
                const rawRid = (row.c[0] ? (row.c[0].v !== null ? row.c[0].v : row.c[0].f) : null);
                if (!rawRid) return;

                const rId = String(rawRid).trim().replace(/ /g, '_');
                const mType = row.c[1] ? String(row.c[1].v || "").trim().toLowerCase() : 'image';
                const rawUrl = row.c[2] ? String(row.c[2].v || "").trim() : null;
                const mOrder = row.c[3] ? parseInt(row.c[3].v) || 999 : 999;

                if (!rawUrl) return;

                const mUrl = convertGDriveUrl(rawUrl, mType === 'video');
                console.log(`[Gallery Debug] Room: ${rId}, Type: ${mType}, Final URL: ${mUrl}`);
                if (!window.galleryData[rId]) window.galleryData[rId] = [];
                window.galleryData[rId].push({ url: mUrl, type: mType, order: mOrder });
            });
            // Sort by order
            Object.keys(window.galleryData).forEach(id => {
                window.galleryData[id].sort((a, b) => a.order - b.order);
            });
            console.log("Parsed Gallery Data:", window.galleryData);
        }

        // Sort by Order already done for window.galleryData above.

        scheduleData = {};
        pricingData = {};

        scheduleResponses.forEach((scheduleRes, index) => {
            if (!scheduleRes || !scheduleRes.table || !scheduleRes.table.rows) return;
            const monthCounts = {};
            scheduleRes.table.rows.forEach(row => {
                if (!row.c || !row.c[0]) return;
                const val = row.c[0].v;
                const formatted = row.c[0].f;
                let dStr = "";
                if (typeof val === 'string' && val.startsWith('Date(')) {
                    const parts = val.substring(5, val.length - 1).split(',');
                    dStr = `${parts[0]}-${String(parseInt(parts[1]) + 1).padStart(2, '0')}`;
                } else {
                    const s = String(formatted || val).trim();
                    if (s.length >= 7) dStr = s.substring(0, 7);
                }
                if (dStr) monthCounts[dStr] = (monthCounts[dStr] || 0) + 1;
            });
            const monthKey = Object.keys(monthCounts).reduce((a, b) => monthCounts[a] > monthCounts[b] ? a : b, null);

            scheduleRes.table.rows.forEach(row => {
                if (!row.c || row.c.length < 3) return;
                const val = row.c[0] ? row.c[0].v : null;
                const formatted = row.c[0] ? row.c[0].f : null;
                const rId = row.c[1] ? row.c[1].v : null;
                const status = row.c[2] ? row.c[2].v : null;
                if (!val || !rId || !status) return;

                let dateStr = "";
                if (typeof val === 'string' && val.startsWith('Date(')) {
                    const parts = val.substring(5, val.length - 1).split(',');
                    dateStr = `${parts[0]}-${String(parseInt(parts[1]) + 1).padStart(2, '0')}-${String(parseInt(parts[2])).padStart(2, '0')}`;
                } else {
                    // Robust normalization: truncate time and handle DD/MM/YYYY
                    let s = String(formatted || val).trim().split(' ')[0]; // Truncate time "00:00:00"
                    if (s.includes('/')) {
                        const parts = s.split('/');
                        if (parts[2] && parts[2].length === 4) { // DD/MM/YYYY
                            dateStr = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                        } else if (parts[0] && parts[0].length === 4) { // YYYY/MM/DD
                            dateStr = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
                        }
                    } else if (s.includes('-')) {
                        const parts = s.split('-');
                        if (parts[0] && parts[0].length === 4) { // YYYY-MM-DD
                            dateStr = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
                        }
                    } else {
                        dateStr = s;
                    }
                }

                const cleanRid = String(rId).trim().replace(/ /g, '_');
                if (!scheduleData[cleanRid]) scheduleData[cleanRid] = {};
                scheduleData[cleanRid][dateStr] = String(status).trim();
                console.log(`[Parser Sync] Room: ${cleanRid}, Date: ${dateStr}, Status: ${status}`);
            });

            if (monthKey && pricingResponses[index] && pricingResponses[index].table) {
                if (!pricingData[monthKey]) pricingData[monthKey] = {};
                pricingResponses[index].table.rows.forEach(row => {
                    if (!row.c || row.c.length < 6) return;
                    const rId = row.c[0] ? row.c[0].v : null;
                    if (!rId) return;
                    const cleanRid = String(rId).trim().replace(/ /g, '_');

                    const getPrice = (cell) => {
                        if (!cell) return 0;
                        if (cell.v !== undefined && typeof cell.v === 'number') return cell.v;
                        if (cell.f) return parseInt(cell.f.replace(/\./g, '')) || 0;
                        return parseInt(String(cell.v).replace(/\./g, '')) || 0;
                    };

                    let imgFromSheet = null;
                    for (let i = 6; i <= 8; i++) {
                        const cell = row.c[i];
                        if (cell && cell.v && typeof cell.v === 'string' && cell.v.startsWith('http')) {
                            imgFromSheet = convertGDriveUrl(cell.v.trim());
                            break;
                        }
                    }

                    const pInfo = {
                        weekday: getPrice(row.c[4]),
                        weekend: getPrice(row.c[5]),
                        maxAdults: row.c[1] ? (typeof row.c[1].v === 'number' ? row.c[1].v : 2) : 2,
                        maxChildren: row.c[2] ? (typeof row.c[2].v === 'number' ? row.c[2].v : 2) : 2,
                        kidsUnder6: String(row.c[3] ? row.c[3].v : "Yes").trim(),
                        img: imgFromSheet
                    };

                    pricingData[monthKey][cleanRid] = pInfo;
                    if (!pricingData['default']) pricingData['default'] = {};
                    if (!pricingData['default'][cleanRid]) pricingData['default'][cleanRid] = pInfo;
                });
            }
        });

        uiLog("Pricing links valid:", validPricing.length);
        uiLog("Schedule links valid:", validSchedule.length);

        // Helper to loop dates (Checkin inclusive, Checkout exclusive)
        const datesToStay = [];
        let curr = new Date(checkinDate);
        while (curr < checkoutDate) {
            datesToStay.push(new Date(curr));
            curr.setDate(curr.getDate() + 1);
        }

        const isOneNightStay = datesToStay.length === 1;
        const nowAtLat = new Date();
        const currentMonthId = nowAtLat.getMonth() + 1;
        const currentYear = nowAtLat.getFullYear();
        const isCurrentMonth = (checkinDate.getMonth() + 1 === currentMonthId) && (checkinDate.getFullYear() === currentYear);

        let allowedRooms = localRooms;
        if (isOneNightStay && isCurrentMonth) {
            // RELAXED: For 1-night stays in current month, check ALL rooms for Gap-Filler status
            allowedRooms = localRooms;
        } else {
            if (adults >= 3) {
                allowedRooms = localRooms;
            } else if (adults === 2 && children === 1) {
                if (isUnder6) {
                    allowedRooms = localRooms.filter(r => r.id === 'Green_Room');
                } else {
                    allowedRooms = localRooms;
                }
            } else if (adults === 2 && children >= 2) {
                allowedRooms = localRooms.filter(r => r.id === 'Green_Room');
            } else if (children > 0 && isUnder6) {
                allowedRooms = localRooms.filter(r => r.id === 'Green_Room');
            }
        }

        roomsContainer.innerHTML = '';
        renderRooms(allowedRooms, scheduleData, pricingData, datesToStay);

    } catch (err) {
        uiLog("CATCH ERROR:", err.message, err.stack);
        console.error("Lỗi khi tải dữ liệu Google Sheets", err);
        alert("Có lỗi kết nối hệ thống phòng: " + err.message);
        roomsContainer.innerHTML = '<p class="text-center text-amber-600 mb-4 bg-amber-50 rounded p-3">Không thể kết nối với dữ liệu phòng theo thời gian thực. Đang hiển thị danh sách phòng tiêu chuẩn.</p>';

        // Fallback Pricing Data
        const fallbackPricingData = {
            'default': {
                'Pink_Room': { weekday: 700000, weekend: 800000 },
                'Gray_Room': { weekday: 900000, weekend: 1000000 },
                'Green_Room': { weekday: 1000000, weekend: 1100000 },
                'Black_Room': { weekday: 1100000, weekend: 1200000 },
                'White_Room': { weekday: 1200000, weekend: 1300000 },
                'Gold_Room': { weekday: 1600000, weekend: 1600000 }
            }
        };

        let fallbackAllowedRooms = localRooms;
        if (adults === 2 && children >= 1) {
            fallbackAllowedRooms = localRooms.filter(r => r.id === 'Green_Room');
        } else if (adults >= 3 && children >= 1) {
            fallbackAllowedRooms = localRooms;
        } else if (children > 0 && isUnder6) {
            fallbackAllowedRooms = localRooms.filter(r => r.id === 'Green_Room');
        }

        const datesToStay = [];
        let curr = new Date(checkinDate);
        while (curr < checkoutDate) {
            datesToStay.push(new Date(curr));
            curr.setDate(curr.getDate() + 1);
        }

        // Render with fallback data and empty schedule (assuming everything is available)
        renderRooms(fallbackAllowedRooms, {}, fallbackPricingData, datesToStay);
    }

    // Logic formatting string YYYY-MM-DD
    function getStr(d) {
        if (!d || !(d instanceof Date)) return "";
        const tz = d.getTimezoneOffset() * 60000;
        return (new Date(d - tz)).toISOString().split('T')[0];
    }

    function renderCurrency(num) {
        return new Intl.NumberFormat('vi-VN').format(num);
    }

    function renderRooms(roomsList, scheduleData, pricingData, datesToStay) {
        if (!datesToStay || datesToStay.length === 0) {
            return;
        }

        roomsList.forEach(room => {
            // Assessment and Multi-night Price Calculation
            let isAvailable = true;
            let totalRoomBasePrice = 0;
            let roomImg = room.img;

            // 1. Check if room is available for ALL days and sum the price
            let bookedOnTargetNight = false;
            for (const date of datesToStay) {
                const dateStr = getStr(date);
                const status = scheduleData[room.id] ? scheduleData[room.id][dateStr] : null;
                if (isBooked(status)) {
                    bookedOnTargetNight = true;
                    uiLog(`Room ${room.id}: Hidden (Actually Booked on ${dateStr}: ${status})`);
                    break;
                }

                // Sum night price (Weekday vs Weekend)
                const monthKey = dateStr.substring(0, 7);
                const currentMonthPricing = pricingData[monthKey] || pricingData['default'] || {};
                const roomSheetData = currentMonthPricing[room.id] || {};

                const dow = date.getDay();
                const isWe = (dow === 5 || dow === 6 || dow === 0);
                const nightPrice = isWe ? (roomSheetData.weekend || 1000000) : (roomSheetData.weekday || 800000);
                totalRoomBasePrice += nightPrice;
            }

            if (bookedOnTargetNight) return; // HIDDEN if actually booked

            // 2. Fetch Dynamic Pricing (for display/capacity)
            const firstDate = datesToStay[0];
            const firstDateStr = getStr(firstDate);
            const mKey = firstDateStr.substring(0, 7);
            const pricing = pricingData[mKey] || pricingData['default'] || {};
            const roomSheetData = pricing[room.id] || {};

            const maxAdults = roomSheetData.maxAdults !== undefined ? roomSheetData.maxAdults : 2;
            const maxChildren = roomSheetData.maxChildren !== undefined ? roomSheetData.maxChildren : 2;
            const kidsUnder6Allowed = roomSheetData.kidsUnder6 || "Yes";

            // Priority: 1. Gallery Sheet (Order 1) -> 2. Pricing Sheet -> 3. Local definition
            if (galleryData[room.id] && galleryData[room.id].length > 0) {
                roomImg = convertGDriveUrl(galleryData[room.id][0].url, false);
            } else if (roomSheetData.img) {
                roomImg = convertGDriveUrl(roomSheetData.img, false);
            }

            // --- LEAD TIME & PERIOD LOGIC (Simplified) ---
            const checkin = datesToStay[0];
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const daysLead = Math.ceil((checkin - today) / (1000 * 60 * 60 * 24));
            const monthId = checkin.getMonth() + 1;

            const STATIC_POLICY = { 1: 5, 2: 5, 3: 4, 4: 7, 5: 7, 6: 5, 7: 5, 8: 5, 9: 7, 10: 7, 11: 7, 12: 5 };
            let minDaysLead = (dynamicPolicyData && dynamicPolicyData.find(p => p.Month_ID === monthId))?.Min_Days_Lead || STATIC_POLICY[monthId] || 7;

            const isWithinPeriod = daysLead <= minDaysLead;

            // --- FILTERING LOGIC ---
            const isOneNightStay = datesToStay.length === 1;
            const nowAtLat = new Date();
            const currentMonthId = nowAtLat.getMonth() + 1;
            const currentYear = nowAtLat.getFullYear();
            const isCurrentMonth = (checkin.getMonth() + 1 === currentMonthId) && (checkin.getFullYear() === currentYear);

            if (isOneNightStay) {
                isAvailable = true;
            } else if (isWithinPeriod) {
                // OK
            } else {
                if (children > 0) {
                    if (isUnder6 && kidsUnder6Allowed.toLowerCase() === "no") isAvailable = false;
                    if (children > maxChildren) isAvailable = false;
                }
            }

            if (!isAvailable) return;

            // Build Room Card HTML
            const specialAttrHtml = room.special ? `
                <div class="bg-primary/10 border border-primary/20 rounded p-2 mb-2">
                    <p class="text-[11px] text-primary font-bold flex items-center gap-1 italic">
                        <span class="material-symbols-outlined text-sm">child_care</span>
                        ${room.special}
                    </p>
                </div>
            ` : '';

            const amenitiesHtml = room.amenities.map(am => `
                <div class="flex items-center gap-1">
                    <span class="material-symbols-outlined text-xl text-primary">done</span>
                    <span>${am}</span>
                </div>
            `).join('');

            const isAlreadySelected = selectedRooms.some(r => r.id === room.id);
            const surchargeMessages = {
                'Pink_Room': 'Phòng tiêu chuẩn 2 khách - Phụ thu khách thứ 3: 450.000đ/đêm',
                'Gray_Room': 'Phòng tiêu chuẩn 2 khách - Phụ thu khách thứ 3: 450.000đ/đêm',
                'Green_Room': 'Phòng tiêu chuẩn 2 khách - Phụ thu khách thứ 3: 450.000đ/đêm',
                'White_Room': 'Phòng tiêu chuẩn 2 khách - Phụ thu khách thứ 3: 600.000đ/đêm',
                'Black_Room': 'Phòng tiêu chuẩn 2 khách - Phụ thu khách thứ 3: 550.000đ/đêm',
                'Gold_Room': 'Phòng tiêu chuẩn 2 khách - Phụ thu khách thứ 3: 650.000đ/đêm'
            };
            const surchargeText = surchargeMessages[room.id] || "";

            const priceHtml = `
                    <div class="flex flex-col gap-0.5 -ml-3">
                        <p class="text-[11px] text-slate-400 uppercase tracking-tight mb-1">Giá Niêm Yết</p>
                        <div class="flex items-baseline gap-1 whitespace-nowrap">
                            <span class="text-[15px] font-bold text-graphite leading-none">${renderCurrency(roomSheetData.weekday || 800000)}</span>
                            <span class="text-[12px] font-normal text-slate-500">/ Đêm Trong Tuần</span>
                        </div>
                        <div class="flex items-baseline gap-1 whitespace-nowrap">
                            <span class="text-[15px] font-bold text-graphite leading-none">${renderCurrency(roomSheetData.weekend || 1000000)}</span>
                            <span class="text-[12px] font-normal text-slate-500">/ Đêm Cuối Tuần</span>
                        </div>
                        <p class="text-[12px] sm:text-[13px] text-black font-bold mt-1.5">${surchargeText}</p>
                    </div>`;

            const buttonHtml = `
                    <div class="relative p-[3px] rounded-xl bg-gradient-to-b from-[#BF953F] via-[#FCF6BA] to-[#AA771C] shadow-lg shadow-black/20 group/btn active:scale-95 transition-transform duration-300">
                        <div class="p-[1px] rounded-[9px] bg-gradient-to-b from-[#AA771C] via-[#FCF6BA] to-[#BF953F]">
                            <button data-room-id="${room.id}" onclick='selectRoom(this, ${JSON.stringify({ id: room.id, name: room.name, img: roomImg, baseRoomTotal: totalRoomBasePrice, nights: datesToStay.length })})' 
                                class="${isAlreadySelected ? 'bg-[#A0824B] text-white pointer-events-none' : 'bg-primary text-white'} hover:bg-[#A0824B] font-sans tracking-wider font-bold text-[15px] sm:text-[16px] py-2.5 px-8 rounded-[8px] transition-all duration-500 flex items-center justify-center leading-none uppercase w-full whitespace-nowrap">
                                ${isAlreadySelected ? 'Đã Chọn' : 'Chọn Phòng'}
                            </button>
                        </div>
                    </div>`;

            const card = document.createElement('div');
            card.className = "rococo-border bg-white shadow-sm overflow-hidden group scroll-animate-card";
            card.innerHTML = `
                <div class="acanthus-corner top-0 left-0">
                    <svg fill="currentColor" viewbox="0 0 24 24"><path d="M2,2 L10,2 C6,2 2,6 2,10 L2,2 Z"></path></svg>
                </div>
                <div class="acanthus-corner top-0 right-0 rotate-90">
                    <svg fill="currentColor" viewbox="0 0 24 24"><path d="M2,2 L10,2 C6,2 2,6 2,10 L2,2 Z"></path></svg>
                </div>
                <!-- Featured Image with Gallery Trigger -->
                <div class="relative h-60 overflow-hidden border-4 border-double border-primary/60 m-2 rounded-sm cursor-pointer group/img"
                     onclick='openGallery("${room.id}")'>
                    <img id="img-${room.id}" alt="${room.name}" 
                         class="w-full h-full object-cover transition-transform duration-700 group-hover/img:scale-110" 
                         src="${roomImg}"
                         onerror="this.style.opacity='0'"/>
                    
                    <!-- Subtle Media Count Badge (Bottom Corner) -->
                    ${window.galleryData[room.id] ? `
                        <div class="absolute bottom-3 right-3 bg-black/60 text-white text-[11px] font-display px-3 py-1.5 rounded-sm backdrop-blur-md border border-white/20 flex items-center gap-2 shadow-xl">
                            <span class="material-symbols-outlined text-[14px]">photo_camera</span>
                            <span>1 / ${window.galleryData[room.id].length}</span>
                        </div>
                    ` : ''}
                </div>
                <div class="px-5 pb-2.5 pt-0">
                    <div class="flex justify-between items-start mb-0 -mt-3">
                        <h3 class="font-display text-2xl font-bold text-graphite">${room.name}</h3>
                    </div>
                    <div class="flex flex-wrap gap-x-4 gap-y-0 mt-1 mb-0 text-sm text-slate-500">
                        <div class="flex items-center gap-1">
                            <span class="material-symbols-outlined text-xl text-primary">square_foot</span>
                            <span>${room.area}</span>
                        </div>
                        ${amenitiesHtml}
                    </div>
                    ${specialAttrHtml}
                    <div class="h-px bg-primary/40 w-full mt-2"></div>
                    <div class="flex items-end justify-between pt-1">
                        ${priceHtml}
                    </div>
                    <div class="flex justify-center mt-3">
                        ${buttonHtml}
                    </div>
                </div>
            `;
            roomsContainer.appendChild(card);
        });

        // Tích hợp Intersection Observer
        const observerOptions = { threshold: 0.1 };
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                } else if (entry.boundingClientRect.top > 0) {
                    entry.target.classList.remove('is-visible');
                }
            });
        }, observerOptions);

        document.querySelectorAll('.scroll-animate-card').forEach(card => observer.observe(card));

        // --- CAPACITY & NO ROOMS LOGIC ---
        const availableRoomsMessage = document.getElementById('available-rooms-message');
        const availableRoomsCount = roomsContainer.querySelectorAll('.scroll-animate-card').length;

        // Lead time period check again for capacity message
        const checkin = datesToStay[0];
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const daysLead = Math.ceil((checkin - today) / (1000 * 60 * 60 * 24));
        const monthId = checkin.getMonth() + 1;
        const STATIC_POLICY = { 1: 5, 2: 5, 3: 4, 4: 7, 5: 7, 6: 5, 7: 5, 8: 5, 9: 7, 10: 7, 11: 7, 12: 5 };
        let minDaysLead = (dynamicPolicyData && dynamicPolicyData.find(p => p.Month_ID === monthId))?.Min_Days_Lead || STATIC_POLICY[monthId] || 7;
        const isWithinPeriod = daysLead <= minDaysLead;

        const roomsNeeded = Math.ceil(adults / 2);

        if (availableRoomsCount === 0) {
            if (availableRoomsMessage) availableRoomsMessage.classList.add('hidden');
            roomsContainer.innerHTML = `
                <div id="no-rooms-alert" class="col-span-full flex flex-col items-center justify-center space-y-4 my-16 animate-shake animate-pop">
                    <span class="material-symbols-outlined text-4xl text-slate-300">event_busy</span>
                    <p class="text-center text-[#c8a96a] font-display italic text-xl">Ngày mà bạn chọn đã hết phòng, xin vui lòng đổi ngày khác.</p>
                </div>
            `;
        } else {
            if (availableRoomsMessage) availableRoomsMessage.classList.remove('hidden');

            if (isWithinPeriod && availableRoomsCount < roomsNeeded) {
                // New Capacity Alert Requirement: Show rooms AND message below
                const alertDiv = document.createElement('div');
                alertDiv.id = "capacity-alert";
                alertDiv.className = "col-span-full flex flex-col items-center justify-center space-y-4 mt-8 mb-16 animate-shake animate-pop bg-[#FAF6EC] p-8 rounded-xl border-2 border-primary/20";
                alertDiv.innerHTML = `
                    <span class="material-symbols-outlined text-4xl text-primary">group_off</span>
                    <p class="text-center text-[#c8a96a] font-display italic text-xl px-4">
                        Hiện tại chỉ còn ${availableRoomsCount} phòng đơn đủ cho ${availableRoomsCount * 2} khách. <br class="hidden sm:block"> Xin vui lòng liên hệ Zalo để được hỗ trợ chi tiết.
                    </p>
                    <a href="https://zalo.me/0889717713" target="_blank" class="mt-4 bg-primary text-white py-2 px-6 rounded-lg font-bold shadow-lg hover:scale-105 transition-transform uppercase text-sm">
                        Liên hệ Zalo
                    </a>
                `;
                roomsContainer.appendChild(alertDiv);
            }
        }
    }

    // Modal & Guest Logic (Move inside DOMContentLoaded to access variables)
    const modal = document.getElementById('edit-booking-modal');
    const modalContent = document.getElementById('edit-booking-content');
    const checkinInput = document.getElementById('modal-checkin');
    const checkoutInput = document.getElementById('modal-checkout');
    const adultCountSpan = document.getElementById('modal-adult-count');
    const childCountSpan = document.getElementById('modal-child-count');
    const childrenAgeInput = document.getElementById('modal-children-age');

    let adultCountLocal = adults || 2;
    let childCountLocal = children || 0;

    const todayVal = new Date().toISOString().split('T')[0];
    if (checkinInput && checkoutInput) {
        checkinInput.min = todayVal;
        checkinInput.addEventListener('change', () => {
            if (checkinInput.value) {
                const ciDate = new Date(checkinInput.value);

                // Set min checkout to at least +1 day
                const minDate = new Date(ciDate);
                minDate.setDate(minDate.getDate() + 1);
                checkoutInput.min = minDate.toISOString().split('T')[0];

                // Automatically set checkout value to +2 days by default
                const defaultCheckout = new Date(ciDate);
                defaultCheckout.setDate(defaultCheckout.getDate() + 2);
                checkoutInput.value = defaultCheckout.toISOString().split('T')[0];
            }
        });
    }

    const modalAgeContainer = document.getElementById('modal-children-ages-container');

    const updateGuestDisplay = () => {
        if (adultCountSpan) adultCountSpan.textContent = adultCountLocal;
        if (childCountSpan) childCountSpan.textContent = childCountLocal;

        if (modalAgeContainer) {
            const currentCount = modalAgeContainer.children.length;
            if (childCountLocal > currentCount) {
                for (let i = currentCount; i < childCountLocal; i++) {
                    const select = document.createElement('select');
                    select.className = "modal-child-age-selector text-[10px] text-[#c8a96a] bg-transparent border-none py-0 pl-0 pr-5 focus:ring-0 uppercase cursor-pointer mt-1 outline-none";
                    select.innerHTML = `
                        <option value="" disabled selected hidden>Trẻ ${i + 1}: độ tuổi</option>
                        ${Array.from({ length: 12 }, (_, j) => `<option value="${j + 1}">${j + 1} tuổi</option>`).join('')}
                    `;
                    modalAgeContainer.appendChild(select);
                }
            } else if (childCountLocal < currentCount) {
                for (let i = currentCount; i > childCountLocal; i--) {
                    modalAgeContainer.removeChild(modalAgeContainer.lastChild);
                }
            }
        }
    };

    const openModal = () => {
        if (checkinInput) checkinInput.value = bookingData.checkin;
        if (checkoutInput) checkoutInput.value = bookingData.checkout;
        adultCountLocal = parseInt(bookingData.adults) || 2;
        childCountLocal = parseInt(bookingData.children) || 0;

        // Reset and populate modal age container
        if (modalAgeContainer) {
            modalAgeContainer.innerHTML = '';
            const ages = (bookingData.childrenAgeCategory || "").split(',').filter(a => a);
            updateGuestDisplay(); // Ensures UI count matches
            const selects = modalAgeContainer.querySelectorAll('select');
            ages.forEach((age, idx) => {
                if (selects[idx]) selects[idx].value = age;
            });
        }

        updateGuestDisplay();
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            void modal.offsetWidth;
            modal.classList.remove('opacity-0');
            if (modalContent) modalContent.classList.remove('translate-y-full');
        }
    };

    const closeModal = () => {
        if (modal) {
            modal.classList.add('opacity-0');
            if (modalContent) modalContent.classList.add('translate-y-full');
            setTimeout(() => {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }, 300);
        }
    };

    const minusAdult = document.getElementById('modal-minus-adult');
    const plusAdult = document.getElementById('modal-plus-adult');
    const minusChild = document.getElementById('modal-minus-child');
    const plusChild = document.getElementById('modal-plus-child');

    if (minusAdult) minusAdult.addEventListener('click', () => { if (adultCountLocal > 1) { adultCountLocal--; updateGuestDisplay(); } });
    if (plusAdult) plusAdult.addEventListener('click', () => { adultCountLocal++; updateGuestDisplay(); });
    if (minusChild) minusChild.addEventListener('click', () => { if (childCountLocal > 0) { childCountLocal--; updateGuestDisplay(); } });
    if (plusChild) plusChild.addEventListener('click', () => { childCountLocal++; updateGuestDisplay(); });

    const closeModalBtn = document.getElementById('close-modal-btn');
    if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
    if (summaryBar) summaryBar.addEventListener('click', openModal);
    if (changeDateBtn) changeDateBtn.addEventListener('click', (e) => { e.stopPropagation(); openModal(); });
    if (headerChangeDateBtn) headerChangeDateBtn.addEventListener('click', (e) => { e.stopPropagation(); openModal(); });

    window.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    const triggerModalWarningEffect = (msg) => {
        const warning = document.getElementById('modal-booking-warning');
        if (!warning) return;
        if (msg) warning.textContent = msg;

        warning.classList.add('active');

        // Force restart animation on every click
        warning.style.animation = 'none';
        void warning.offsetWidth;
        warning.style.animation = '';

        warning.classList.remove('animate-shake', 'animate-pop');
        void warning.offsetWidth;
        warning.classList.add('animate-shake', 'animate-pop');
    };

    const saveBtn = document.getElementById('modal-save-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const ci = checkinInput ? checkinInput.value : '';
            const co = checkoutInput ? checkoutInput.value : '';
            if (!ci || !co) { alert("Vui lòng chọn ngày nhận và trả phòng"); return; }
            const ciDate = parseLocal(ci);
            const coDate = parseLocal(co);
            const diffDays = Math.ceil((coDate - ciDate) / (1000 * 60 * 60 * 24));

            if (diffDays <= 0) {
                alert("Ngày trả phòng phải sau ngày nhận phòng.");
                return;
            }

            // 1. Policy Check (Relaxed for 1-night support)
            // Removed strict filtering to allow guests to select and view 1-night stays
            // as requested by the user.

            // 3. Child Age Validation (Sync with index.html)
            const modalAgeSelectors = modalAgeContainer.querySelectorAll('select');
            const modalChildrenAges = Array.from(modalAgeSelectors).map(s => s.value);
            if (childCountLocal > 0 && modalChildrenAges.some(age => !age)) {
                alert("Vui lòng chọn đầy đủ độ tuổi của trẻ em.");
                return;
            }

            const childrenAgeStr = modalChildrenAges.join(',');

            sessionStorage.setItem('chonVillageBooking', JSON.stringify({
                ...bookingData,
                checkin: ci,
                checkout: co,
                adults: adultCountLocal,
                children: childCountLocal,
                childrenAgeCategory: childrenAgeStr
            }));
            window.location.reload();
        });
    }

    if (summaryBar) {
        const summaryTop = summaryBar.getBoundingClientRect().top + window.scrollY;
        const headerTitleContainer = document.getElementById('header-title-container');
        const headerDecorTop = document.getElementById('header-decor-top');
        const headerDecorBottom = document.getElementById('header-decor-bottom');

        window.addEventListener('scroll', () => {
            if (window.scrollY > summaryTop) {
                headerTitleContainer?.classList.replace('left-1/2', 'left-4');
                headerTitleContainer?.classList.remove('-translate-x-1/2');
                headerTitle?.classList.replace('text-[28px]', 'text-[22px]');
                headerDecorTop?.classList.remove('opacity-0');
                headerDecorBottom?.classList.remove('opacity-0');
                headerChangeDateBtn?.classList.replace('opacity-0', 'opacity-100');
                headerChangeDateBtn?.classList.remove('pointer-events-none');
                changeDateBtn?.classList.add('opacity-0', 'pointer-events-none');
            } else {
                headerTitleContainer?.classList.replace('left-4', 'left-1/2');
                headerTitleContainer?.classList.add('-translate-x-1/2');
                headerTitle?.classList.replace('text-[22px]', 'text-[28px]');
                headerDecorTop?.classList.add('opacity-0');
                headerDecorBottom?.classList.add('opacity-0');
                headerChangeDateBtn?.classList.replace('opacity-100', 'opacity-0');
                changeDateBtn?.classList.remove('opacity-0', 'pointer-events-none');
            }
        });
    }

    // Xử lý nút Xác nhận đặt cuối cùng
    const confirmBtn = document.getElementById('confirm-waitlist-btn');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', (e) => {
            if (selectedRooms.length === 0) return;

            // --- CAPACITY VALIDATION (Adults only as per request) ---
            const totalAdults = adults;
            const totalCapacity = selectedRooms.length * 3; // Max 3 adults per room
            const warningEl = document.getElementById('waitlist-booking-warning');

            if (totalAdults > totalCapacity) {
                // Prevent global click listener from hiding it immediately on second click
                e.stopPropagation();

                if (warningEl) {
                    warningEl.classList.remove('hidden');
                    // Sync with triggerModalWarningEffect behavior
                    warningEl.classList.add('animate-shake', 'animate-pop');
                    warningEl.style.animation = 'none';
                    void warningEl.offsetWidth;
                    warningEl.style.animation = '';

                    // Auto-hide after 3 seconds (Reset timer on every click)
                    if (window.waitlistWarningTimeout) clearTimeout(window.waitlistWarningTimeout);
                    window.waitlistWarningTimeout = setTimeout(() => {
                        warningEl.classList.add('hidden');
                    }, 3000);

                    // Click anywhere to hide immediately (one-time listener)
                    // We only add it if it's not already visible to avoid multiple listeners
                    if (!window.isWaitlistWarningActive) {
                        window.isWaitlistWarningActive = true;
                        const hideNow = () => {
                            warningEl.classList.add('hidden');
                            window.isWaitlistWarningActive = false;
                            document.removeEventListener('click', hideNow);
                        };
                        setTimeout(() => document.addEventListener('click', hideNow), 10);
                    }
                }
                return;
            }

            if (warningEl) warningEl.classList.add('hidden');
            confirmBtn.textContent = "Đang xử lý...";

            // Lưu danh sách phòng vào sessionStorage
            sessionStorage.setItem('chonVillageSelectedRooms', JSON.stringify(selectedRooms));
            sessionStorage.setItem('chonVillageSelectedRoom', JSON.stringify(selectedRooms[0]));

            setTimeout(() => {
                window.location.href = 'checkout.html';
            }, 500);
        });
    }
});

// --- Waitlist Logic (Phòng chờ đặt) ---
let selectedRooms = [];

// Hàm render danh sách phòng chờ dưới footer
function renderWaitlist() {
    const container = document.getElementById('waitlist-items');
    const footer = document.getElementById('waitlist-footer');
    if (!container || !footer) return;

    // 1. Đồng bộ trạng thái các nút trên danh sách phòng
    const allRoomButtons = document.querySelectorAll('button[data-room-id]');
    allRoomButtons.forEach(btn => {
        const roomId = btn.getAttribute('data-room-id');
        const isSelected = selectedRooms.some(r => String(r.id) === String(roomId));

        if (isSelected) {
            btn.textContent = 'ĐÃ CHỌN';
            btn.classList.add('bg-[#A0824B]', 'pointer-events-none');
            btn.classList.remove('bg-primary');
        } else {
            btn.textContent = 'CHỌN PHÒNG';
            btn.classList.remove('bg-[#A0824B]', 'pointer-events-none');
            btn.classList.add('bg-primary');
        }
    });

    const contactContainer = document.getElementById('floating-contact-container');

    if (selectedRooms.length === 0) {
        footer.classList.add('translate-y-full');
        if (contactContainer) contactContainer.style.bottom = '128px'; // bottom-32
        return;
    }

    footer.classList.remove('translate-y-full');
    if (contactContainer) contactContainer.style.bottom = '240px'; // Higher to avoid all overlaps

    container.innerHTML = selectedRooms.map((room, index) => `
        <div id="waitlist-item-${room.id}" class="relative group/item shrink-0 transition-opacity duration-300">
            <div class="w-12 h-12 rounded-lg overflow-hidden border-2 border-primary shadow-sm bg-white">
                <img src="${room.img}" class="w-full h-full object-cover">
            </div>
            <!-- Nút X để xóa phòng -->
            <button onclick="removeFromWaitlist(${index})" class="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full size-5 flex items-center justify-center shadow-md active:scale-90 transition-transform z-10">
                <span class="material-symbols-outlined text-[12px] font-bold">close</span>
            </button>
        </div>
    `).join('');
}

// Hàm xóa phòng khỏi danh sách
window.removeFromWaitlist = function (index) {
    selectedRooms.splice(index, 1);
    renderWaitlist();
};

// Hiệu ứng "Bay" (Fly to Footer)
function animateFly(startEl, targetEl, imgSrc, callback) {
    const flyContainer = document.getElementById('fly-container');
    if (!flyContainer || !startEl || !targetEl) {
        if (callback) callback();
        return;
    }

    const startRect = startEl.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();

    const clone = document.createElement('img');
    clone.src = imgSrc;
    clone.className = 'fixed object-cover rounded-sm z-[200] transition-all duration-700 cubic-bezier(0.25, 1, 0.5, 1)';

    // Vị trí bắt đầu
    clone.style.top = `${startRect.top}px`;
    clone.style.left = `${startRect.left}px`;
    clone.style.width = `${startRect.width}px`;
    clone.style.height = `${startRect.height}px`;
    clone.style.opacity = '1';

    // Force reflow for first selection animation
    void clone.offsetWidth;

    flyContainer.appendChild(clone);
    // Bắt đầu bay - Thêm một chút delay nhỏ để đảm bảo Footer đã bắt đầu hiện
    setTimeout(() => {
        requestAnimationFrame(() => {
            const freshTargetRect = targetEl.getBoundingClientRect();
            clone.style.top = `${freshTargetRect.top}px`;
            clone.style.left = `${freshTargetRect.left}px`;
            clone.style.width = `${freshTargetRect.width}px`;
            clone.style.height = `${freshTargetRect.height}px`;
            clone.style.opacity = '0.7';
            clone.style.borderRadius = '8px';
            clone.style.transform = 'scale(0.3)';
        });
    }, 50);

    // Xóa clone sau khi bay xong
    setTimeout(() => {
        clone.remove();
        if (callback) callback();
    }, 750);
}

// Override hàm selectRoom để hỗ trợ waitlist
window.selectRoom = function (btn, roomData) {
    // 1. Kiểm tra nếu phòng đã có trong list thì không thêm nữa
    const isAlreadyIn = selectedRooms.some(r => String(r.id) === String(roomData.id));
    if (isAlreadyIn) return;

    // 2. Chuyển nút sang trạng thái "Đã chọn" ngay lập tức
    btn.textContent = 'ĐÃ CHỌN';
    btn.classList.add('bg-[#A0824B]', 'pointer-events-none');
    btn.classList.remove('bg-primary');

    // 3. Thêm vào mảng local
    selectedRooms.push(roomData);

    // 4. Render lại waitlist để tạo placeholder
    renderWaitlist();

    // 5. Tìm placeholder vừa tạo và ẩn nó đi để chờ ảnh bay tới
    const targetItem = document.getElementById(`waitlist-item-${roomData.id}`);
    const imgEl = document.getElementById(`img-${roomData.id}`);

    if (targetItem) {
        targetItem.style.opacity = '0'; // Ẩn item thực tế

        // Chạy hiệu ứng bay đến đúng vị trí của placeholder
        animateFly(imgEl, targetItem, roomData.img, () => {
            targetItem.style.opacity = '1'; // Hiện item thực tế khi bay xong
        });
    }
};


// --- Reviews Logic ---
const REVIEWS_API_URL = "https://script.google.com/macros/s/AKfycbyKwYdqY1Xd762VehUWY8wCKCdek6rc0lASlrUfZVh33B4X_ozjWSxqDUt3PIz27cg/exec";

// Fallback Mock Data based on the user's screenshot
const MOCK_REVIEWS = [
    {
        name: "Linhh Trúc",
        info: "Local Guide · 6 bài đánh giá · 10 ảnh",
        rating: "5/5",
        time: "3 tuần trước trên Google",
        content: "100đ cho phòng nghỉ, nhân viên siêu siêu dễ thương và nhiệt tình ạ. Recoment mng tới đây nghỉ dưỡng khi tới đà lạt ạaa. Nhất định lần sau quay lại mình sẽ ghé đây tiếp ạ",
        tripType: "Chuyến nghỉ mát",
        travelGroup: "Cặp đôi",
        roomScore: 5,
        serviceScore: 5,
        locationScore: 5,
        highlights: "Sang trọng, Lãng mạn, Yên tĩnh, Phù hợp với trẻ em, Giá tốt"
    },
    {
        name: "Mai Anh",
        info: "2 bài đánh giá",
        rating: "5/5",
        time: "1 tháng trước trên Google",
        content: "Phòng ốc cực kỳ sạch sẽ và mang phong cách châu cổ điển rất sang trọng. Điểm cộng lớn là view nhìn ra thung lũng rất chill, ngắm bình minh tuyệt vời.",
        tripType: "Kỳ nghỉ gia đình",
        travelGroup: "Gia đình",
        roomScore: 5,
        serviceScore: 5,
        locationScore: 4,
        highlights: "View đẹp, Yên tĩnh, Sang trọng"
    },
    {
        name: "Minh Quân",
        info: "10 bài đánh giá",
        rating: "5/5",
        time: "2 tháng trước trên Tripadvisor",
        content: "Trải nghiệm đáng nhớ tại Chồn Village. Nội thất phòng đều được chăm chút tỉ mỉ, giường cực kỳ êm. Bạn nhân viên take care chu đáo từ lúc check in tới check out.",
        tripType: "Công tác",
        travelGroup: "Đi một mình",
        roomScore: 5,
        serviceScore: 5,
        locationScore: 5,
        highlights: "Phục vụ xuất sắc, Sạch sẽ, Giường thoải mái"
    }
];

async function loadReviews() {
    try {
        const res = await fetch(REVIEWS_API_URL);
        const data = await res.json();
        if (data.error || !Array.isArray(data) || data.length === 0) {
            console.warn("API trả về lỗi hoặc chưa có data, sử dụng Mock Data mẫu cho khách hàng");
            renderReviews(MOCK_REVIEWS);
        } else {
            // Map the parsed data dynamically based on fuzzy column names
            const parsedData = data.map(row => {
                const getVal = (possibleKeys) => {
                    const key = Object.keys(row).find(k => possibleKeys.some(pk => k.toLowerCase().includes(pk)));
                    return key ? row[key] : "";
                };

                return {
                    name: getVal(["tên", "khách", "name", "tác giả"]) || "Khách hàng",
                    info: getVal(["loại", "guide", "thông tin", "info"]),
                    rating: getVal(["số sao", "đánh giá", "rating", "điểm"]) || "5/5",
                    time: getVal(["thời gian", "ngày", "time", "date"]) || "Gần đây",
                    content: getVal(["nội", "dung", "nhận xét", "content", "review"]) || "",
                    tripType: getVal(["loại chuyến", "trip"]),
                    travelGroup: getVal(["nhóm", "khách", "group"]),
                    roomScore: getVal(["phòng"]),
                    serviceScore: getVal(["dịch vụ", "service"]),
                    locationScore: getVal(["vị trí", "location"]),
                    highlights: getVal(["nổi bật", "highlight", "điểm"])
                };
            }).filter(r => r.content && r.name !== "Khách hàng");

            if (parsedData.length > 0) {
                renderReviews(parsedData);
            } else {
                renderReviews(MOCK_REVIEWS);
            }
        }
    } catch (error) {
        console.error("Lỗi khi fetch reviews từ Google Sheet:", error);
        renderReviews(MOCK_REVIEWS);
    }
}

function renderReviews(reviews) {
    const section = document.getElementById('reviews-section');
    const slider = document.getElementById('reviews-slider');
    if (!section || !slider) return;

    slider.innerHTML = reviews.map((r, i) => {
        const initials = r.name.trim().substring(0, 2).toUpperCase();

        let starsHtml = '';
        const starCount = parseInt(String(r.rating).charAt(0)) || 5;
        for (let s = 0; s < starCount; s++) {
            starsHtml += `<span class="material-symbols-outlined text-[#C8A96A] text-[14px]" style="font-variation-settings: 'FILL' 1;">star</span>`;
        }

        const buildDetailRow = (label, val) => {
            if (!val) return '';
            return `<div class="flex justify-between items-center text-[12px] border-b border-primary/10 pb-1 mb-1.5">
                        <span class="text-slate-500 font-bold">${label}:</span>
                        <span class="text-graphite font-medium text-right max-w-[60%] sm:max-w-[70%]">${val}</span>
                    </div>`;
        };
        const buildScoreItem = (label, val) => {
            if (!val) return '';
            return `<div class="flex flex-col items-center">
                        <span class="text-slate-500 font-bold text-[10px] uppercase">${label}</span>
                        <span class="text-graphite font-bold text-[13px]">${val}</span>
                    </div>`;
        };

        const hasScores = r.roomScore || r.serviceScore || r.locationScore;
        const scoreRow = hasScores ? `
                <div class="flex justify-around items-center bg-[#FAF6EC] p-2 rounded-md mt-3 border border-primary/20">
                    ${buildScoreItem('Phòng', r.roomScore)}
                    ${buildScoreItem('Dịch vụ', r.serviceScore)}
                    ${buildScoreItem('Vị trí', r.locationScore)}
                </div>
                ` : '';

        return `
                <div class="snap-start shrink-0 w-[85vw] sm:w-[350px] bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.06)] border border-[#C8A96A]/20 p-5 flex flex-col relative overflow-hidden active:scale-[0.98] transition-all duration-300 review-card-animate will-change-transform select-none cursor-grab active:cursor-grabbing" style="animation-delay: ${i * 100}ms;">
                <!-- Decor Elements -->
                <div class="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-[#C8A96A]/10 to-transparent rounded-bl-full -z-0 pointer-events-none"></div>
                <span class="material-symbols-outlined absolute top-3 right-3 text-[#C8A96A]/20 text-5xl -z-0 pointer-events-none" style="font-variation-settings: 'FILL' 1;">format_quote</span>
                
                <!-- Reviewer Header -->
                <div class="flex items-center gap-3 relative z-10 mb-4">
                    <div class="w-11 h-11 rounded-full bg-gradient-to-br from-[#C8A96A] to-[#A0824B] text-white flex items-center justify-center font-display font-bold text-lg shadow-inner shrink-0">
                        ${initials}
                    </div>
                    <div class="flex flex-col min-w-0">
                        <span class="font-bold text-graphite text-[16px] leading-tight truncate w-full">${r.name}</span>
                        ${r.info ? `<span class="text-slate-400 text-[11px] truncate w-full mt-0.5">${r.info}</span>` : ''}
                    </div>
                </div>

                <!-- Rating & Time -->
                <div class="flex items-center flex-wrap gap-2 mb-3 relative z-10">
                    <div class="flex items-center gap-0.5">
                        <span class="font-bold text-graphite text-sm mr-1 leading-none pt-0.5">${r.rating}</span>
                        ${starsHtml}
                    </div>
                    <span class="text-slate-400 text-[11px]">• ${r.time}</span>
                </div>

                <!-- Content -->
                <p class="text-slate-600 text-[14px] leading-relaxed italic mb-5 relative z-10 break-words line-clamp-[7]">
                    "${r.content}"
                </p>

                <!-- Detailed Specs -->
                <div class="mt-auto relative z-10">
                    ${buildDetailRow('Loại chuyến đi', r.tripType)}
                    ${buildDetailRow('Nhóm khách', r.travelGroup)}

                    ${r.highlights ? `
                    <div class="mt-2 text-[12px] text-slate-500 bg-slate-50 p-2 rounded border border-slate-100 italic">
                        <span class="font-bold text-graphite not-italic">Điểm nổi bật:</span> ${r.highlights}
                    </div>
                    ` : ''}

                    ${scoreRow}
                </div>
            </div>
                `;
    }).join('');

    section.classList.remove('hidden');
    // Bật lên với hiệu ứng fade in
    setTimeout(() => {
        section.classList.remove('opacity-0');

        // Thêm tính năng kéo thả cuộn ngang (drag to scroll) cho máy tính
        let isDown = false;
        let startX;
        let scrollLeft;

        slider.addEventListener('mousedown', (e) => {
            isDown = true;
            slider.style.scrollBehavior = 'auto'; // Tạm tắt smooth scroll khi user mousedown
            slider.style.scrollSnapType = 'none'; // Tắt snap khi mousedown để kéo mượt
            startX = e.pageX - slider.offsetLeft;
            scrollLeft = slider.scrollLeft;
        });
        slider.addEventListener('mouseleave', () => {
            if (!isDown) return;
            isDown = false;
            slider.style.scrollBehavior = 'smooth';
            slider.style.scrollSnapType = 'x mandatory';
        });
        slider.addEventListener('mouseup', () => {
            isDown = false;
            slider.style.scrollBehavior = 'smooth';
            slider.style.scrollSnapType = 'x mandatory';
            // Snap về thẻ gần nhất (cần một chút timeout để thả chuột kích hoạt cuộn)
            setTimeout(() => { slider.scrollBy({ left: 1, behavior: 'smooth' }); }, 50);
        });
        slider.addEventListener('mousemove', (e) => {
            if (!isDown) return;
            e.preventDefault();
            const x = e.pageX - slider.offsetLeft;
            const walk = (x - startX) * 2; // Tốc độ cuộn x2
            slider.scrollLeft = scrollLeft - walk;
        });

    }, 100);
}

function openGallery(roomId) {
    const media = window.galleryData[roomId];
    if (!media || media.length === 0) {
        console.warn("No gallery data for room:", roomId);
        return;
    }
    currentGallery = media;
    currentRoomId = roomId;
    currentGalleryIndex = 0;

    // Create Modal if not exists
    let modal = document.getElementById('room-gallery-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'room-gallery-modal';
        modal.className = 'fixed inset-0 z-[9999] bg-[#FFFAF0] opacity-0 pointer-events-none transition-all duration-500 flex flex-col items-center p-0 overflow-y-auto overflow-x-hidden';
        modal.innerHTML = `
            <style>
                #room-gallery-modal.active { opacity: 1 !important; pointer-events: auto !important; }
                .grid-container { max-width: 1200px; width: 100%; margin: 80px auto; padding: 0 20px; }
                .grid-layout { display: grid; grid-template-columns: 2fr 1fr; gap: 10px; border-radius: 12px; overflow: hidden; margin-bottom: 20px; }
                @media (max-width: 768px) { .grid-layout { grid-template-columns: 1fr; } }
                .grid-item { position: relative; cursor: pointer; overflow: hidden; background: #f8f8f8; border: 1px solid rgba(0,0,0,0.05); border-radius: 8px; }
                .grid-item img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.5s ease; pointer-events: none; }
                .grid-item:hover img { transform: scale(1.05); }
                .grid-feature { grid-row: span 2; height: 410px; }
                @media (max-width: 768px) { .grid-feature { grid-row: span 1; height: 250px; } }
                .grid-secondary { height: 200px; }
                .grid-thumbnails { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; padding-bottom: 50px; }
                @media (max-width: 480px) { .grid-thumbnails { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); } }
                .grid-thumb { aspect-ratio: 16/10; }
                
                .detail-container { position: fixed; inset: 0; background: black; z-index: 200; display: none; flex-direction: column; align-items: center; justify-content: flex-start; padding: 0; overflow: hidden; }
                .detail-container.active { display: flex; }
                .gallery-media { max-width: 100vw; max-height: calc(100vh - 180px); width: auto; height: auto; object-fit: contain; }
                .nav-btn, .detail-close-btn-bottom { background: rgba(255, 255, 255, 0.1); color: white; border: 1px solid rgba(255,255,255,0.2); width: 56px; height: 56px; border-radius: 50%; cursor: pointer; backdrop-filter: blur(8px); transition: 0.3s; display: flex; align-items: center; justify-content: center; z-index: 220; }
                .nav-btn:hover, .detail-close-btn-bottom:hover { background: rgba(255,255,255,0.3); transform: scale(1.1); border-color: white; }
                .detail-close-btn-bottom:hover { background: rgba(239, 68, 68, 0.4); } 
                
                .detail-footer-controls { position: absolute; bottom: 0; left: 0; right: 0; padding: 20px 0 30px; display: flex; flex-direction: column; align-items: center; background: linear-gradient(to top, rgba(0,0,0,0.8), transparent); z-index: 210; pointer-events: none; }
                .detail-footer-controls > * { pointer-events: auto; }
                
                .gallery-header { position: sticky; top: 0; width: 100%; background: rgba(255, 250, 240, 0.95); backdrop-filter: blur(12px); z-index: 101; padding: 20px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(191, 149, 63, 0.2); box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
                .gallery-close-btn { color: #1a1a1a; cursor: pointer; border: 1px solid #c8a96a; padding: 8px; border-radius: 50%; transition: all 0.3s; display: flex; align-items: center; justify-content: center; }
                .gallery-close-btn:hover { background: #c8a96a; color: white; }
                
                .video-play-icon { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.2); color: white; transition: background 0.3s; }
                .grid-item:hover .video-play-icon { background: rgba(0,0,0,0.4); }
            </style>
            
            <div class="gallery-header">
                <div style="font-family: 'Gilda Display', serif; font-style: italic; font-size: 1.25rem; color: #BF953F;">Chồn Village Gallery</div>
                <div class="gallery-close-btn" onclick="closeGallery()">
                    <span class="material-symbols-outlined">close</span>
                </div>
            </div>
 
            <div id="grid-view" class="grid-container animate-[fadeIn_0.5s_ease-out]">
                <!-- Grid items injected here -->
            </div>
 
            <div id="detail-view" class="detail-container">
                <div id="detail-media-container" class="w-full h-full flex items-start justify-center p-0 pt-2"></div>
                
                <div class="detail-footer-controls">
                    <!-- Navigation & Close Buttons Area -->
                    <div class="flex gap-8 mb-4 z-[210]">
                        <button class="nav-btn" onclick="prevGallery()">
                            <span class="material-symbols-outlined">chevron_left</span>
                        </button>
                        <button class="nav-btn" onclick="nextGallery()">
                            <span class="material-symbols-outlined">chevron_right</span>
                        </button>
                        <button class="detail-close-btn-bottom" onclick="closeGallery()">
                            <span class="material-symbols-outlined">close</span>
                        </button>
                    </div>

                    <!-- Mini Thumb Bar -->
                    <div id="detail-thumbs" class="flex gap-2 overflow-x-auto max-w-full px-4 scrollbar-hide h-16"></div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    renderGalleryGrid();
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function renderGalleryGrid() {
    const gridView = document.getElementById('grid-view');
    const detailView = document.getElementById('detail-view');
    if (!gridView || !detailView) return;

    gridView.style.display = 'block';
    detailView.classList.remove('active');

    if (!currentGallery || currentGallery.length === 0) return;

    const feature = currentGallery[0];
    const secondary = currentGallery.slice(1, 3);
    const rest = currentGallery.slice(3);

    const finalFeatureThumb = convertGDriveUrl(feature.url, false, false, "w1200");

    gridView.innerHTML = `
        <div class="grid-layout">
            <div class="grid-item grid-feature" onclick="openDetail(0)">
                <img src="${finalFeatureThumb}" loading="lazy" class="w-full h-full object-cover" 
                     onerror="this.style.opacity='0'"/>
                ${feature.type === 'video' ? `
                    <div class="video-play-icon">
                        <span class="material-symbols-outlined text-white text-6xl">play_circle</span>
                    </div>
                ` : ''}
            </div>
            ${secondary.map((m, i) => {
        const finalThumb = convertGDriveUrl(m.url, false, false, "w1024");
        return `
                <div class="grid-item grid-secondary" onclick="openDetail(${i + 1})">
                    <img src="${finalThumb}" loading="lazy" class="w-full h-full object-cover" 
                         onerror="this.style.opacity='0'"/>
                    ${m.type === 'video' ? `
                        <div class="video-play-icon">
                            <span class="material-symbols-outlined text-white text-4xl">play_circle</span>
                        </div>
                    ` : ''}
                </div>`;
    }).join('')}
        </div>
        <div class="grid-thumbnails">
            ${rest.map((m, i) => {
        const finalThumb = convertGDriveUrl(m.url, false, false, "w800");
        return `
                <div class="grid-item grid-thumb" onclick="openDetail(${i + 3})">
                    <img src="${finalThumb}" loading="lazy" class="w-full h-full object-cover" 
                         onerror="this.style.opacity='0'"/>
                    ${m.type === 'video' ? `
                        <div class="video-play-icon">
                            <span class="material-symbols-outlined text-white text-3xl">play_circle</span>
                        </div>
                    ` : ''}
                </div>`;
    }).join('')}
        </div>
    `;
}

function openDetail(index) {
    const gridView = document.getElementById('grid-view');
    const detailView = document.getElementById('detail-view');
    if (!gridView || !detailView) return;

    gridView.style.display = 'none';
    detailView.classList.add('active');
    currentGalleryIndex = index;
    updateDetailDisplay();
}

function showGrid() {
    renderGalleryGrid();
}

function updateDetailDisplay() {
    const container = document.getElementById('detail-media-container');
    const thumbContainer = document.getElementById('detail-thumbs');
    const item = currentGallery[currentGalleryIndex];

    if (!container || !item) return;

    if (item.type === 'video') {
        const isDirectVideo = item.url.includes('cloudinary.com') ||
            item.url.match(/\.(mp4|webm|mov|m4v|ogv)/i);

        if (isDirectVideo) {
            const posterUrl = item.url.includes('cloudinary.com') ? convertGDriveUrl(item.url, false, false, "q_auto,f_auto,so_2") : "";
            container.innerHTML = `
                <video 
                    controls 
                    autoplay
                    muted
                    ${posterUrl ? `poster="${posterUrl}"` : ''}
                    class="gallery-media animate-[fadeIn_0.5s_ease-out]" 
                    style="width: 100%; height: 85vh; background: #000; border-radius: 8px;"
                    playsinline>
                    <source src="${item.url}" type="video/mp4">
                    Your browser does not support the video tag.
                </video>`;
        } else {
            // Iframe for YouTube/GDrive
            const finalUrl = convertGDriveUrl(item.url, true);
            container.innerHTML = `<iframe 
                src="${finalUrl}" 
                class="gallery-media" 
                style="width: 100%; height: 85vh; border: none;" 
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                allowfullscreen 
                referrerpolicy="no-referrer-when-downgrade"></iframe>`;
        }
    } else {
        // w1600 for instant mobile loading
        const highResUrl = convertGDriveUrl(item.url, false, true);
        container.innerHTML = `<img src="${highResUrl}" class="gallery-media animate-[fadeIn_0.2s_ease-out]"/>`;

        // --- AGGRESSIVE PRELOAD (Next 2) ---
        [1, 2].forEach(offset => {
            const idx = (currentGalleryIndex + offset) % currentGallery.length;
            const nextItem = currentGallery[idx];
            if (nextItem && nextItem.type !== 'video') {
                const nextImg = new Image();
                nextImg.src = convertGDriveUrl(nextItem.url, false, true);
            }
        });
    }

    if (thumbContainer) {
        thumbContainer.innerHTML = currentGallery.map((m, idx) => {
            // Use w300 for clearer thumbnails that are still fast
            const thumbUrl = convertGDriveUrl(m.url, false, false, "w300");
            const isActive = idx === currentGalleryIndex;
            return `
            <div onclick="jumpToGallery(${idx})" 
                 ${isActive ? 'id="active-thumb"' : ''}
                 class="w-14 h-14 flex-shrink-0 cursor-pointer border-2 transition-all duration-300 rounded overflow-hidden relative ${isActive ? 'border-[#BF953F] ring-2 ring-[#BF953F]/20 scale-105' : 'border-transparent opacity-60 hover:opacity-100'}">
                <img src="${thumbUrl}" class="w-full h-full object-cover bg-slate-800 pointer-events-none"
                     onerror="this.style.opacity='0'"/>
                ${m.type === 'video' ? `
                    <div class="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
                        <span class="material-symbols-outlined text-white text-xl">play_circle</span>
                    </div>
                ` : ''}
            </div>
        `;
        }).join('');

        // Ensure active thumb is in view
        setTimeout(() => {
            const activeThumb = document.getElementById('active-thumb');
            if (activeThumb) {
                activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
        }, 50);
    }
}

function jumpToGallery(index) {
    currentGalleryIndex = index;
    updateDetailDisplay();
}

function closeGallery() {
    const modal = document.getElementById('room-gallery-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = 'auto';
        const container = document.getElementById('detail-media-container');
        if (container) container.innerHTML = '';
    }
}

function nextGallery() {
    currentGalleryIndex = (currentGalleryIndex + 1) % currentGallery.length;
    updateDetailDisplay();
}

function prevGallery() {
    currentGalleryIndex = (currentGalleryIndex - 1 + currentGallery.length) % currentGallery.length;
    updateDetailDisplay();
}

// Global Export
window.openGallery = openGallery;
window.closeGallery = closeGallery;
window.nextGallery = nextGallery;
window.prevGallery = prevGallery;
window.jumpToGallery = jumpToGallery;
window.showGrid = showGrid;
window.openDetail = openDetail;

// Gọi loadReview sau khi page load
document.addEventListener('DOMContentLoaded', () => {
    console.log("Rooms script v11.16 loaded and active (Final Policy Fix).");
    setTimeout(loadReviews, 500);
});
