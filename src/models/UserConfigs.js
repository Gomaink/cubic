const mongoose = require('mongoose');

const userConfigsSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    inputVolume: { type: Number, default: 100, min: 0, max: 100 }, 
    outputVolume: { type: Number, default: 100, min: 0, max: 100 } 
});

const UserConfigs = mongoose.model('UserConfigs', userConfigsSchema);

module.exports = UserConfigs;
