'use strict'

const { Schema, model } = require('mongoose')
const { QA_ENVIRONMENTS } = require('../config/agenticBlogQa.config')

const schema = new Schema({
  _id: { type: String, required: true },
  environment: { type: String, enum: QA_ENVIRONMENTS, required: true, immutable: true },
  owner: { type: String, required: true, maxlength: 200 },
  leaseUntil: { type: Date, required: true, index: true }
}, {
  collection: 'QaTopicReservationLocks',
  timestamps: true,
  autoCreate: false,
  autoIndex: false
})

module.exports = {
  QaTopicReservationLock: model('QaTopicReservationLock', schema)
}
