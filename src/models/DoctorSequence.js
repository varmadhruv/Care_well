const mongoose = require('mongoose');

const DoctorSequenceSchema = new mongoose.Schema({
  _id: { type: String, default: 'doctor_id_seq' },
  lastIndex: { type: Number, default: -1 }
}, { timestamps: true, collection: 'doctor_sequences' });

const DoctorSequence = mongoose.models.DoctorSequence || mongoose.model('DoctorSequence', DoctorSequenceSchema);

module.exports = DoctorSequence;
