'use strict';

const TelemetryService = require('../services/telemetry.service');
const { SuccessResponse } = require('../core/success.response');

class TelemetryController {
    captureEvents = async (req, res, next) => {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const events = Array.isArray(body.events) ? body.events : body.event ? [body.event] : [];

        const metadata = await TelemetryService.captureEvents({
            sessionContext: {
                ...(req.telemetryContext || {}),
                sessionDoc: req.telemetrySession || null
            },
            events
        });

        new SuccessResponse({
            message: 'Telemetry captured',
            metadata
        }).send(res);
    }
}

module.exports = new TelemetryController();
