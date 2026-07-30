// ===== Background Monitoring & Notifications =====

let monitoringInterval = null;
let lastOrderCount = 0;
const enableMonitoringCheckbox = document.getElementById('enableMonitoring');

// Initialize monitoring checkbox
if (enableMonitoringCheckbox) {
    // Check localStorage for saved preference
    const savedPreference = localStorage.getItem('enableMonitoring');
    if (savedPreference === 'true') {
        enableMonitoringCheckbox.checked = true;
        startMonitoring();
    }
    
    enableMonitoringCheckbox.addEventListener('change', (e) => {
        if (e.target.checked) {
            startMonitoring();
            localStorage.setItem('enableMonitoring', 'true');
        } else {
            stopMonitoring();
            localStorage.setItem('enableMonitoring', 'false');
        }
    });
}

function startMonitoring() {
    console.log('Starting background monitoring...');
    
    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                showToast('Notifications enabled! You\'ll be notified of new orders.');
            }
        });
    }
    
    // Get initial count
    fetchOrderCount();
    
    // Poll every 30 seconds
    monitoringInterval = setInterval(() => {
        fetchOrderCount();
    }, 30000); // 30 seconds
}

function stopMonitoring() {
    console.log('Stopping background monitoring...');
    if (monitoringInterval) {
        clearInterval(monitoringInterval);
        monitoringInterval = null;
    }
}

async function fetchOrderCount() {
    try {
        // Don't show completed orders in monitoring
        const params = new URLSearchParams();
        params.append('search', '');
        params.append('stage', '');
        params.append('show_completed', 'false');
        
        const response = await fetch(`${API_BASE}/orders?${params.toString()}`);
        const data = await response.json();
        
        if (data.success) {
            const currentCount = data.count;
            
            // Check if count increased
            if (lastOrderCount > 0 && currentCount > lastOrderCount) {
                const newOrders = currentCount - lastOrderCount;
                showNewOrderNotification(newOrders);
            }
            
            lastOrderCount = currentCount;
        }
    } catch (error) {
        console.error('Error fetching order count for monitoring:', error);
    }
}

function showNewOrderNotification(count) {
    const title = `${count} New Order${count > 1 ? 's' : ''}!`;
    const body = `${count} new order${count > 1 ? 's have' : ' has'} been added to the system.`;
    
    // Show browser notification
    if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification(title, {
            body: body,
            icon: '/static/favicon.ico',
            badge: '/static/favicon.ico',
            tag: 'new-orders',
            requireInteraction: false
        });
        
        notification.onclick = function() {
            window.focus();
            notification.close();
            loadOrders(); // Refresh the orders list
        };
        
        // Auto-close after 5 seconds
        setTimeout(() => notification.close(), 5000);
    }
    
    // Also show toast
    showToast(body);
    
    // Play sound (if browser allows)
    try {
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBjWM0fPTgjMGHm7A7+OZSA0PVanp6qVXFAlEnNjxwWwkBjGIzfPZgjYGG2W77O6fSwwOUaHk6qxaFQlBmdLxzHUoCSptwO/omUwQD1Se4+yuXBgJPZPP8dJ8LgYsdeL87qNWFgk+mtXw1H4yBShy1u/pmU0QD1Oa4+ytWxYJQJTM8dV/MgYqcNnv66RUFQ1BoM/v');
        audio.volume = 0.3;
        audio.play().catch(() => {
            // Silently fail if audio doesn't play
        });
    } catch (e) {
        // Audio not supported, ignore
    }
}

// Stop monitoring when page is unloaded
window.addEventListener('beforeunload', () => {
    stopMonitoring();
});














