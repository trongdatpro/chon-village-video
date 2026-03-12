document.addEventListener('DOMContentLoaded', () => {
    // 1. Retrieve Data
    const bookingDataStr = sessionStorage.getItem('chonVillageBooking');
    const selectedRoomStr = sessionStorage.getItem('chonVillageSelectedRoom');

    if (!bookingDataStr || !selectedRoomStr) {
        window.location.href = 'index.html';
        return;
    }

    const bookingData = JSON.parse(bookingDataStr);
    const roomData = JSON.parse(selectedRoomStr);

    // 2. Format Dates
    const parseLocal = (dateStr) => {
        const [y, m, d] = dateStr.split('-');
        return new Date(y, m - 1, d);
    };

    const checkinDate = parseLocal(bookingData.checkin);
    const checkoutDate = parseLocal(bookingData.checkout);

    // Calculate nights
    const diffTime = Math.abs(checkoutDate - checkinDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    const formatDateObj = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    const dateRangeStr = `${formatDateObj(checkinDate)} - ${formatDateObj(checkoutDate)} (${diffDays} đêm)`;

    // 3. Populate Summary
    document.getElementById('checkout-room-img').style.backgroundImage = `url('${roomData.img}')`;
    document.getElementById('checkout-room-name').textContent = roomData.name;
    document.getElementById('checkout-dates').textContent = dateRangeStr;

    const renderCurrency = (num) => new Intl.NumberFormat('vi-VN').format(num) + 'đ';

    const totalAmount = parseInt(roomData.totalPrice);
    const depositAmount = totalAmount / 2;

    document.getElementById('checkout-total').textContent = renderCurrency(totalAmount);
    document.getElementById('checkout-deposit').textContent = renderCurrency(depositAmount);

    // 4. Agreement Logic to Reveal Payment
    const agreeCheckbox = document.getElementById('agree-checkbox');
    const paymentSection = document.getElementById('payment-section');
    const confirmBtn = document.getElementById('confirm-btn');

    agreeCheckbox.addEventListener('change', (e) => {
        if (e.target.checked) {
            paymentSection.classList.remove('hidden');
            // Small timeout to allow display:block to apply before animating opacity
            setTimeout(() => {
                paymentSection.classList.remove('opacity-0');
            }, 50);

            confirmBtn.classList.remove('hidden');
        } else {
            paymentSection.classList.add('opacity-0');
            setTimeout(() => {
                paymentSection.classList.add('hidden');
            }, 500); // Wait for transition

            confirmBtn.classList.add('hidden');
        }
    });

    // 5. Confirmation Toast Logic
    const toast = document.getElementById('toast-message');

    confirmBtn.addEventListener('click', () => {
        // Open Zalo with Template Message
        const message = `Chào Chồn, mình vừa đặt phòng ${roomData.name} từ ${formatDateObj(checkinDate)} đến ${formatDateObj(checkoutDate)}. Gửi Chồn biên lai chuyển khoản nhé!`;
        const zaloUrl = `https://zalo.me/0369877478?text=${encodeURIComponent(message)}`;
        window.open(zaloUrl, '_blank');

        const phone = bookingData.phone || 'của bạn';
        toast.innerHTML = `
            <div class="flex flex-col gap-1 items-center">
                <span class="material-symbols-outlined text-green-600 text-2xl">check_circle</span>
                <span>Đang kết nối tới Zalo...</span>
                <span>Xin cảm ơn bạn đã lựa chọn Chồn Village.</span>
            </div>
        `;

        // Show toast
        toast.classList.remove('opacity-0');

        // Hide after 5 seconds then redirect home
        setTimeout(() => {
            toast.classList.add('opacity-0');
            setTimeout(() => {
                // Clear session and go to home page
                sessionStorage.removeItem('chonVillageBooking');
                sessionStorage.removeItem('chonVillageSelectedRoom');
                window.location.href = 'index.html';
            }, 500);
        }, 5000);
    });
});
