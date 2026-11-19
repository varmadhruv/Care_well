const mongoose = require('mongoose');

const DoctorSchema = new mongoose.Schema({
  doctorId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
    index: true,
    match: /^([A-Z]-\d{3}|HD-\d{3})$/
  },
  name: { type: String, required: true, trim: true },
  dob: { type: String, trim: true },
  age: { type: Number },
  gender: { type: String, trim: true, default: '' },
  bloodGroup: { type: String, trim: true, default: '' },
  username: { type: String, trim: true, unique: true, sparse: true },
  password: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  emailVerified: { type: Boolean, default: false },
  phone: { type: String, trim: true },
  altPhone: { type: String, trim: true },
  clinicName: { type: String, trim: true },
  clinicAddress: { type: String, trim: true },
  nearestStation: { type: String, trim: true },
  homeVisit: { type: Boolean, default: false },
  certificate: { type: String },
  certificates: [{
    name: { type: String, trim: true },
    file: { type: String },
    url: { type: String },
    description: { type: String, trim: true, default: '' }
  }],
  experience: { type: String, trim: true },
  role: { type: String, trim: true, default: 'Medical Doctor' },
  specialty: { type: String, trim: true },
  status: { type: String, enum: ['Active', 'Pending', 'Verified', 'Suspended', 'Terminated'], default: 'Active' },
  photo: { type: String },
  doctorPhoto: { type: String },
  clinicPhotos: [{ type: String }],
  availability: { type: String },
  workingHours: { type: String },
  workingTime: { type: String },
  sessionToken: { type: String, trim: true },
  sessionExpiresAt: { type: Date }
}, { timestamps: true, collection: 'doctors' });

const Doctor = mongoose.models.Doctor || mongoose.model('Doctor', DoctorSchema);

module.exports = Doctor;
