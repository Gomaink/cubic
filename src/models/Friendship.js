const mongoose = require('mongoose');

const friendshipSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});

const Friendship = mongoose.model('Friendship', friendshipSchema);

module.exports = Friendship;
