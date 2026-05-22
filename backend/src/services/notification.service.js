'use strict'

const notification = require('../models/notification.model');
const admin = require('../models/admin.model');

class NotificationService {
    static async notifyCancelRequest({ order, userId, reason }) {
        if (!order) return [];
        const orderId = order._id;
        const shopIds = Array.isArray(order.order_products)
            ? [...new Set(order.order_products.map((item) => item.shopId).filter(Boolean))]
            : [];

        const payload = {
            orderId,
            orderStatus: order.order_status,
            reason: reason || null
        };

        const notifications = [];

        const adminIds = await admin.find({ status: 'active' }).select('_id').lean();
        if (adminIds.length) {
            adminIds.forEach((adminUser) => {
                notifications.push({
                    noti_type: 'order.cancel.request',
                    noti_sender_id: userId,
                    noti_sender_type: 'User',
                    noti_receiver_id: adminUser._id,
                    noti_receiver_type: 'Admin',
                    noti_title: 'Cancel request',
                    noti_message: `Order ${orderId} requested cancellation`,
                    noti_payload: payload
                });
            });
        } else {
            notifications.push({
                noti_type: 'order.cancel.request',
                noti_sender_id: userId,
                noti_sender_type: 'User',
                noti_receiver_id: null,
                noti_receiver_type: 'Admin',
                noti_title: 'Cancel request',
                noti_message: `Order ${orderId} requested cancellation`,
                noti_payload: payload
            });
        }

        shopIds.forEach((shopId) => {
            notifications.push({
                noti_type: 'order.cancel.request',
                noti_sender_id: userId,
                noti_sender_type: 'User',
                noti_receiver_id: shopId,
                noti_receiver_type: 'Shop',
                noti_title: 'Cancel request',
                noti_message: `Order ${orderId} requested cancellation`,
                noti_payload: payload
            });
        });

        if (!notifications.length) return [];
        return await notification.insertMany(notifications);
    }
}

module.exports = NotificationService;
