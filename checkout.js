document.addEventListener('DOMContentLoaded', () => {
    // 1. Helper Function
    const renderCurrency = (num) => new Intl.NumberFormat('vi-VN').format(num) + 'đ';

    // 2. Retrieve Data From Session
    const bookingDataStr = sessionStorage.getItem('chonVillageBooking');
    const selectedRoomsStr = sessionStorage.getItem('chonVillageSelectedRooms');
    const selectedRoomStr = sessionStorage.getItem('chonVillageSelectedRoom'); // Fallback for single room

    if (!bookingDataStr || (!selectedRoomsStr && !selectedRoomStr)) {
        console.warn("Booking data not found in session, redirecting...");
        window.location.href = 'index.html';
        return;
    }

    const bookingData = JSON.parse(bookingDataStr);
    const roomsData = selectedRoomsStr ? JSON.parse(selectedRoomsStr) : [JSON.parse(selectedRoomStr)];
    const adultsCount = parseInt(bookingData.adults) || 2;

    console.log("Booking Data:", bookingData);
    console.log("Rooms Data:", roomsData);

    // 3. Date Formatting
    const parseLocal = (dateStr) => {
        if (!dateStr) return new Date();
        const [y, m, d] = dateStr.split('-');
        return new Date(y, m - 1, d);
    };

    const checkinDate = parseLocal(bookingData.checkin);
    const checkoutDate = parseLocal(bookingData.checkout);
    const diffTime = Math.abs(checkoutDate - checkinDate);
    const nights = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;

    const formatDateObj = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    const dateRangeStr = `${formatDateObj(checkinDate)} - ${formatDateObj(checkoutDate)} (${nights} đêm)`;

    // 4. Pricing & Surcharge Logic
    let baseRoomTotal = 0;
    const surchargeRates = [];

    roomsData.forEach(room => {
        baseRoomTotal += parseInt(room.baseRoomTotal) || 0;
        
        // Use dynamic surcharge from room data, fallback to default if missing
        const rate = parseInt(room.surcharge) || 450000;
        surchargeRates.push(rate);
    });

    // Calculate Extra Guests (3rd person in shared rooms)
    // Formula: Adults - (Rooms * 2)
    const extraGuestsCount = Math.max(0, adultsCount - (roomsData.length * 2));
    
    // Sort rates for logic application
    surchargeRates.sort((a, b) => a - b);
    
    let surchargePerNight = 0;
    
    // Case-specific logic for 3 rooms
    if (roomsData.length === 3) {
        const uniqueRates = new Set(surchargeRates).size;
        
        if (extraGuestsCount === 1) {
            // 7 guests in 3 rooms: 1 extra guest
            if (uniqueRates === 3) {
                // 3 different surcharges: use the average (middle) price
                surchargePerNight = surchargeRates[1];
            } else {
                // 2 or more have the same fee: use the lowest fee
                surchargePerNight = surchargeRates[0];
            }
        } else if (extraGuestsCount === 2) {
            // 8 guests in 3 rooms: 2 extra guests
            // Rule derived: lowest + middle (average)
            surchargePerNight = surchargeRates[0] + surchargeRates[1];
        } else {
            // Standard loop for other guest counts in 3 rooms
            for (let i = 0; i < extraGuestsCount; i++) {
                surchargePerNight += surchargeRates[i] || surchargeRates[0];
            }
        }
    } else {
        // Standard rule for 1 or 2 rooms: Use lowest available surcharge rates
        for (let i = 0; i < extraGuestsCount; i++) {
            // Use the i-th lowest rate (if available, else fallback to lowest)
            const rateToApply = surchargeRates[i] !== undefined ? surchargeRates[i] : surchargeRates[0];
            surchargePerNight += rateToApply;
        }
    }

    const surchargeTotal = surchargePerNight * nights;
    const totalAmount = baseRoomTotal + surchargeTotal;
    const depositAmount = Math.floor(totalAmount / 2);

    // 5. Populate All UI Elements
    const setSafeText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    const roomNamesLabel = roomsData.map(r => r.name).join(' + ');
    setSafeText('checkout-room-name', roomNamesLabel || "Phòng");
    setSafeText('checkout-dates', dateRangeStr);
    setSafeText('checkout-room-base', renderCurrency(baseRoomTotal));
    setSafeText('checkout-total', renderCurrency(totalAmount));
    setSafeText('checkout-deposit', renderCurrency(depositAmount));

    const imgEl = document.getElementById('checkout-room-img');
    if (imgEl) {
        // Show first room image or a collage if possible, but first room is fine
        imgEl.style.backgroundImage = `url('${roomsData[0].img}')`;
    }

    const surchargeRow = document.getElementById('checkout-surcharge-row');
    if (surchargeRow) {
        if (surchargeTotal > 0) {
            surchargeRow.classList.remove('hidden');
            setSafeText('checkout-surcharge', renderCurrency(surchargeTotal));
        } else {
            surchargeRow.classList.add('hidden');
        }
    }

    // 6. visibility & Agreement Logic
    const agreeCheckbox = document.getElementById('agree-checkbox');
    const summarySection = document.getElementById('summary-section');
    const paymentSection = document.getElementById('payment-section');
    const confirmBtn = document.getElementById('confirm-btn');

    // Reset Initial State
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.classList.remove('hidden');
        confirmBtn.classList.add('opacity-50', 'cursor-not-allowed', 'pointer-events-none');
    }
    
    if (summarySection) {
        summarySection.classList.add('hidden', 'opacity-0');
    }
    if (paymentSection) {
        paymentSection.classList.add('hidden', 'opacity-0');
    }

    // Toggle Visibility on Checkbox
    if (agreeCheckbox) {
        agreeCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            
            if (isChecked) {
                // Show Summary & Payment
                if (summarySection) {
                    summarySection.classList.remove('hidden');
                    setTimeout(() => summarySection.classList.remove('opacity-0'), 10);
                }
                if (paymentSection) {
                    paymentSection.classList.remove('hidden');
                    setTimeout(() => paymentSection.classList.remove('opacity-0'), 10);

                    // Update QR and Transfer Content
                    const qrImg = document.getElementById('checkout-qr');
                    const qrLoading = document.getElementById('qr-loading');
                    const transferContentEl = document.getElementById('checkout-transfer-content');
                    
                    const transferContent = `CHON ${bookingData.phone || ''}`.toUpperCase();
                    if (transferContentEl) transferContentEl.textContent = transferContent;

                    if (qrImg) {
                        const bankId = 'VCB';
                        const accountNo = '0889717713';
                        const template = 'compact';
                        const qrUrl = `https://img.vietqr.io/image/${bankId}-${accountNo}-${template}.png?amount=${depositAmount}&addInfo=${encodeURIComponent(transferContent)}&accountName=NGUYEN%20VAN%20CHON`;
                        
                        qrImg.src = qrUrl;
                        qrImg.onload = () => {
                            if (qrLoading) qrLoading.classList.add('hidden');
                        };
                    }
                }
                // Unlock Button
                if (confirmBtn) {
                    confirmBtn.disabled = false;
                    confirmBtn.classList.remove('opacity-50', 'cursor-not-allowed', 'pointer-events-none');
                }
            } else {
                // Hide Summary & Payment
                if (summarySection) {
                    summarySection.classList.add('opacity-0');
                    setTimeout(() => summarySection.classList.add('hidden'), 500);
                }
                if (paymentSection) {
                    paymentSection.classList.add('opacity-0');
                    setTimeout(() => paymentSection.classList.add('hidden'), 500);
                }
                // Lock Button
                if (confirmBtn) {
                    confirmBtn.disabled = true;
                    confirmBtn.classList.add('opacity-50', 'cursor-not-allowed', 'pointer-events-none');
                }
            }
        });
    }

    // 7. Zalo Submission Logic
    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            const message = `Xin chào Chồn Village,\nTôi muốn gửi biên lai chuyển khoản cho đơn đặt phòng:\n- Phòng: ${roomData.name}\n- Thời gian: ${dateRangeStr}\n- Tổng: ${renderCurrency(totalAmount)}\n- Đã cọc (50%): ${renderCurrency(depositAmount)}\n- Tên khách: ${bookingData.name || 'Khách hàng'}\n- SĐT: ${bookingData.phone || ''}`;
            
            const zaloMsg = encodeURIComponent(message);
            const zaloUrl = `https://zalo.me/0889717713?text=${zaloMsg}`;
            const zaloDeepLink = `zalo://chat?phone=0889717713&text=${zaloMsg}`;
            
            // Try deep link
            window.location.href = zaloDeepLink;
            
            // Fallback
            setTimeout(() => {
                window.open(zaloUrl, '_blank');
            }, 500);

            // Toast feedback
            const toast = document.getElementById('toast-message');
            if (toast) {
                toast.innerHTML = `
                    <div class="flex flex-col gap-1 items-center">
                        <span class="material-symbols-outlined text-green-600 text-2xl">check_circle</span>
                        <span>Đang kết nối tới Zalo...</span>
                        <span>Xin cảm ơn bạn đã lựa chọn Chồn Village.</span>
                    </div>
                `;
                toast.classList.remove('opacity-0');
                
                setTimeout(() => {
                    toast.classList.add('opacity-0');
                    setTimeout(() => {
                        sessionStorage.removeItem('chonVillageBooking');
                        sessionStorage.removeItem('chonVillageSelectedRoom');
                        window.location.href = 'index.html';
                    }, 500);
                }, 5000);
            }
        });
    }
});
