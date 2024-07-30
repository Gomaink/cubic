const mongoose = require('mongoose');
const { encrypt } = require('../utils/cryptoUtils');

// Message Schema
const messageSchema = new mongoose.Schema({
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});

// Middleware para criptografar a mensagem antes de salvar
messageSchema.pre('save', function(next) {
    this.message = encrypt(this.message);
    next();
});

// Message Model
const Message = mongoose.model('Message', messageSchema);

module.exports = Message;
