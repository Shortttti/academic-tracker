import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged, 
  updateProfile, 
  setPersistence, 
  browserLocalPersistence, 
  browserSessionPersistence 
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { 
  getFirestore, 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  orderBy, 
  limit, 
  onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAuCWmbCIyzUcuhNe4-scxqvGU9mjzhDXg",
  authDomain: "my-study-tracker-1a084.firebaseapp.com",
  projectId: "my-study-tracker-1a084",
  storageBucket: "my-study-tracker-1a084.firebasestorage.app",
  messagingSenderId: "439333538406",
  appId: "1:439333538406:web:1bd730409d890753f43ba7",
  measurementId: "G-PPGDXQD5XM"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// تاريخ بداية الدراسة الفعلي للفصل
const SEMESTER_START_DATE = new Date("2026-08-22T00:00:00");
const INITIAL_ADMIN_UID = "85B0Qw38nrYzpS5wwcXA5CvJNcC3";
let adminUIDs = [INITIAL_ADMIN_UID];

let currentUser = null;
let currentCourses = [];
let currentTasks = [];
let currentScheduleSlots = [];
let publicResources = [];
let officialAssignments = [];
let examsList = [];
let isAdmin = false;
let expandedCourseId = null;

// التبديل بين التبويبات
window.switchTab = function(target) {
  document.querySelectorAll(".nav-item").forEach(n => {
    n.classList.toggle("active", n.getAttribute("data-target") === target);
  });
  ["home", "courses", "schedule", "resources", "tasks", "admin"].forEach(tab => {
    const el = document.getElementById(`tab-content-${tab}`);
    if (el) el.style.display = (tab === target) ? "block" : "none";
  });
  if (target === "home") renderHomeDashboardUI();
  if (target === "admin" && isAdmin) loadAdminUsersList();
};

// حساب عدد المحاضرات التي انقضت فعلياً منذ 22 أغسطس 2026 بناءً على الجدول الأسبوعي
function calculateElapsedLectures(courseId) {
  const slots = currentScheduleSlots.filter(s => s.courseId === courseId);
  if (slots.length === 0) return 0;

  const dayMap = { "الأحد": 0, "الإثنين": 1, "الثلاثاء": 2, "الأربعاء": 3, "الخميس": 4 };
  const targetDays = slots.map(s => dayMap[s.day]).filter(d => d !== undefined);
  
  const now = new Date();
  if (now < SEMESTER_START_DATE) return 0;

  let count = 0;
  let cursor = new Date(SEMESTER_START_DATE);
  while (cursor <= now) {
    if (targetDays.includes(cursor.getDay())) {
      count++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

// مراقبة حالة تسجيل الدخول
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    document.getElementById("auth-screen").style.display = "none";
    document.getElementById("main-app").style.display = "flex";
    switchTab("home");

    // التحقق من صلاحيات المشرف
    const adminDoc = await getDoc(doc(db, "system_configs", "admins"));
    if (adminDoc.exists() && adminDoc.data().uids) {
      adminUIDs = [...new Set([...adminUIDs, ...adminDoc.data().uids])];
    }
    isAdmin = adminUIDs.includes(user.uid);
    document.getElementById("admin-badge").style.display = isAdmin ? "flex" : "none";

    // بيانات المستخدم وإنذارات الحرمان
    onSnapshot(doc(db, "users", user.uid), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      document.getElementById("home-greeting-name").textContent = `أهلاً بك يا مهندس/ـة ${data.displayName || ''} ✨`;
      document.getElementById("user-points-display").textContent = `${data.points || 0} نقطة`;

      // فحص وجود إنذار حرمان مباشر من المشرف
      const alertBox = document.getElementById("student-urgent-dn-alert");
      if (data.dnAlert && data.dnAlert.active) {
        document.getElementById("student-urgent-dn-msg").textContent = `مقرر: ${data.dnAlert.course} • ${data.dnAlert.message}`;
        alertBox.style.display = "block";
      } else {
        alertBox.style.display = "none";
      }
    });

    // جلب المقررات وحساب المحاضرات الفعلية
    onSnapshot(collection(db, "users", user.uid, "courses"), (snap) => {
      currentCourses = [];
      snap.forEach(d => currentCourses.push({ id: d.id, ...d.data() }));
      renderCoursesUI();
      updateAllCourseDropdowns();
    });

    // جلب الجدول الأسبوعي
    onSnapshot(collection(db, "users", user.uid, "schedule"), (snap) => {
      currentScheduleSlots = [];
      snap.forEach(d => currentScheduleSlots.push({ id: d.id, ...d.data() }));
      renderCoursesUI();
    });

    // جلب التكاليف الرسمية
    onSnapshot(collection(db, "supervisor_assignments"), (snap) => {
      officialAssignments = [];
      snap.forEach(d => officialAssignments.push({ id: d.id, ...d.data() }));
      renderOfficialAssignmentsUI();
      if (isAdmin) renderAdminAssignmentsUI();
    });

    if (isAdmin) {
      loadAdminUsersList();
    }
  } else {
    document.getElementById("main-app").style.display = "none";
    document.getElementById("auth-screen").style.display = "flex";
  }
});

// إقرار الطالب بقراءة إنذار الحرمان
document.getElementById("btn-ack-dn-alert")?.addEventListener("click", async () => {
  if (currentUser) {
    await updateDoc(doc(db, "users", currentUser.uid), { "dnAlert.active": false });
  }
});

// عرض قائمة المقررات بالحساب الصحيح للمحاضرات المنقضية
function renderCoursesUI() {
  const container = document.getElementById("courses-container");
  if (!container) return;
  container.innerHTML = "";

  let totalElapsedAll = 0;
  let attendedAll = 0;

  currentCourses.forEach(course => {
    const elapsed = calculateElapsedLectures(course.id);
    const attended = course.attendedLectures || 0;
    const absences = course.absences || 0;
    const totalSemLectures = course.totalLectures || 30;
    
    totalElapsedAll += elapsed;
    attendedAll += attended;

    const maxAbsences = Math.floor(totalSemLectures / 4);
    const remainingAbsences = maxAbsences - absences;

    const card = document.createElement("div");
    card.className = `course-card ${expandedCourseId === course.id ? 'expanded' : ''}`;
    card.innerHTML = `
      <div class="course-card-header" onclick="toggleCourseExpand('${course.id}')">
        <div>
          <span class="course-badge" style="background-color: ${course.color || '#0F766E'}20; color: ${course.color || '#0F766E'};">
            ${course.name} (${course.code})
          </span>
        </div>
        <span style="font-size: 11px; font-weight: bold; color: var(--text-muted);">
          حضورك: ${attended} من أصل ${elapsed} منعقدة (الترم: ${totalSemLectures})
        </span>
      </div>
      <div class="course-card-body">
        <div class="stepper-row">
          <span>المحاضرات التي حضرتها:</span>
          <div class="stepper-controls">
            <button class="step-btn" onclick="updateLectureCount('${course.id}', -1)">-</button>
            <strong>${attended} / ${elapsed} المنعقدة</strong>
            <button class="step-btn" onclick="updateLectureCount('${course.id}', 1)">+</button>
          </div>
        </div>
        <div class="dn-calculator-box-compact">
          <div>
            <strong>نظام الغياب والحرمان:</strong><br>
            <span class="${absences >= maxAbsences ? 'dn-danger' : 'dn-safe'}">
              الغيابات: ${absences} من ${maxAbsences} مسموحة (باقي ${Math.max(0, remainingAbsences)} قبل الحرمان)
            </span>
          </div>
          <div class="stepper-controls">
            <button class="step-btn" onclick="updateAbsenceCount('${course.id}', -1)">-</button>
            <strong>${absences}</strong>
            <button class="step-btn" onclick="updateAbsenceCount('${course.id}', 1)" style="color:red;">+</button>
          </div>
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  const overallPct = totalElapsedAll === 0 ? 100 : Math.min(100, Math.round((attendedAll / totalElapsedAll) * 100));
  const missedLec = Math.max(0, totalElapsedAll - attendedAll);
  document.getElementById("missed-lectures-count").textContent = `${missedLec} محاضرات`;
  document.getElementById("overall-progress-bar").style.width = `${overallPct}%`;
  document.getElementById("overall-percent-label").textContent = `${overallPct}% نسبة المواكبة للمحاضرات المنعقدة`;
}

window.toggleCourseExpand = (id) => {
  expandedCourseId = (expandedCourseId === id) ? null : id;
  renderCoursesUI();
};

window.updateLectureCount = async (id, delta) => {
  const c = currentCourses.find(item => item.id === id);
  if (!c) return;
  const newCount = Math.max(0, (c.attendedLectures || 0) + delta);
  await updateDoc(doc(db, "users", currentUser.uid, "courses", id), { attendedLectures: newCount });
};

window.updateAbsenceCount = async (id, delta) => {
  const c = currentCourses.find(item => item.id === id);
  if (!c) return;
  const newAbs = Math.max(0, (c.absences || 0) + delta);
  await updateDoc(doc(db, "users", currentUser.uid, "courses", id), { absences: newAbs });
};

// مولّد خطة المذاكرة السريعة المتطور (Cram Planner)
document.getElementById("btn-generate-cram-plan")?.addEventListener("click", () => {
  const courseCode = document.getElementById("cram-course-select").value;
  const examDateStr = document.getElementById("cram-exam-date").value;
  const dailyHours = parseFloat(document.getElementById("cram-daily-hours").value) || 4;

  if (!courseCode || !examDateStr) {
    alert("الرجاء اختيار المقرر وموعد الاختبار.");
    return;
  }

  const examDate = new Date(examDateStr);
  const today = new Date();
  const daysLeft = Math.ceil((examDate - today) / (1000 * 60 * 60 * 24));

  if (daysLeft <= 0) {
    alert("موعد الاختبار يجب أن يكون في تاريخ مستقبلي.");
    return;
  }

  const course = currentCourses.find(c => c.code === courseCode) || { chapters: [{done:false},{done:false},{done:false}] };
  const totalChapters = (course.chapters || []).length || 5;
  const unstudiedChapters = (course.chapters || []).filter(ch => !ch.done).length || totalChapters;

  const totalStudyHours = daysLeft * dailyHours;
  const hoursPerChapter = (totalStudyHours / unstudiedChapters).toFixed(1);
  const pomodoroSessions = Math.round((dailyHours * 60) / 30);

  const box = document.getElementById("cram-result-box");
  box.style.display = "block";
  box.innerHTML = `
    <strong style="color:var(--primary-teal); font-size:12.5px;">📋 خطة المذاكرة المقترحة حتى يوم الاختبار:</strong>
    <p style="margin-top:4px;">• الأيام المتبقية: <strong>${daysLeft} يوم</strong> | الشباتر المطلوبة: <strong>${unstudiedChapters} شباتر</strong></p>
    <p>• إجمالي الساعات المتاحة لك: <strong>${totalStudyHours} ساعة</strong> بمعدل <strong>${dailyHours} ساعات يومياً</strong></p>
    <p>• التوزيع المستهدف: تخصيص <strong>${hoursPerChapter} ساعة لكل شابتر</strong></p>
    <p style="color:#059669; font-weight:bold; margin-top:4px;">💡 نصيحة الإنتاجية: أنجز <strong>${pomodoroSessions} جلسات بومودورو (25د تركيز)</strong> يومياً لختم المقرر بسهولة.</p>
  `;
});

// عرض التكاليف الرسمية المشتركة
function renderOfficialAssignmentsUI() {
  const container = document.getElementById("official-assignments-container");
  if (!container) return;
  document.getElementById("official-assignments-count").textContent = officialAssignments.length;

  if (officialAssignments.length === 0) {
    container.innerHTML = `<p style="font-size:11.5px; color:var(--text-muted); text-align:center;">لا توجد تكاليف رسمية حالياً 🎉</p>`;
    return;
  }

  container.innerHTML = "";
  officialAssignments.forEach(asg => {
    const card = document.createElement("div");
    card.style.cssText = "background:var(--subtle-bg); padding:10px; border-radius:10px; margin-bottom:6px; border:1px solid var(--border-subtle);";
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <strong style="font-size:12px;">${asg.title}</strong>
          <span style="font-size:10px; color:var(--text-muted); display:block;">مقرر: ${asg.courseCode || 'عام'} • التسليم: ${asg.dueDate || 'قريباً'}</span>
          <p style="font-size:11px; margin-top:3px;">${asg.details || ''}</p>
        </div>
        <button class="btn-primary" style="padding:4px 8px; font-size:10.5px; width:auto; margin:0;" onclick="markAssignmentDone('${asg.id}')">تأكيد الإنجاز ✅</button>
      </div>
    `;
    container.appendChild(card);
  });
}

window.markAssignmentDone = async (asgId) => {
  if (!currentUser) return;
  await setDoc(doc(db, "supervisor_assignments", asgId, "completions", currentUser.uid), {
    studentName: currentUser.displayName || "طالب/ـة",
    completedAt: new Date().toISOString()
  });
  alert("تم تأكيد إنجاز التكليف بنجاح!");
};

// جديد: قائمة إدارة المستخدمين وحذفهم بلوحة المشرف
async function loadAdminUsersList() {
  const container = document.getElementById("admin-users-manage-list");
  if (!container || !isAdmin) return;

  const usersSnap = await getDocs(collection(db, "users"));
  document.getElementById("kpi-total-students").textContent = usersSnap.size;
  container.innerHTML = "";

  usersSnap.forEach(uDoc => {
    const u = uDoc.data();
    const uid = uDoc.id;
    const card = document.createElement("div");
    card.className = "request-item-card";
    card.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:8px;";
    card.innerHTML = `
      <div>
        <strong style="font-size:11.5px;">${u.displayName || 'بدون اسم'}</strong> (${u.gender || 'طالب/ـة'} - ${u.section || 'عام'})
        <span style="display:block; font-size:10px; color:var(--text-muted);">${u.email || uid}</span>
      </div>
      <div style="display:flex; gap:4px;">
        <button class="btn-timer" style="background:#EF4444; color:white; padding:4px 8px; font-size:10px;" onclick="adminDeleteUser('${uid}', '${u.displayName}')">حذف ✕</button>
        <button class="btn-timer" style="background:#D97706; color:white; padding:4px 8px; font-size:10px;" onclick="adminWarnUser('${uid}', '${u.displayName}')">إنذار 🚨</button>
      </div>
    `;
    container.appendChild(card);
  });
}

// حذف طالب من قِبل المشرف
window.adminDeleteUser = async (uid, name) => {
  if (confirm(`هل أنت متأكد من حذف حساب الطالب (${name}) نهائياً من النظام؟`)) {
    await deleteDoc(doc(db, "users", uid));
    alert("تم حذف الحساب بنجاح.");
    loadAdminUsersList();
  }
};

// إرسال إنذار حرمان يظهر على شاشة الطالب الرئيسية
window.adminWarnUser = async (uid, name) => {
  const course = prompt(`أدخل اسم المقرر المراد إنذار الطالب (${name}) فيه:`);
  if (!course) return;
  const message = prompt("أدخل نص الإنذار:", "تنبيه: اقتربت من بلوغ نسبة الحرمان 25% في هذا المقرر.");
  if (!message) return;

  await updateDoc(doc(db, "users", uid), {
    dnAlert: {
      active: true,
      course,
      message,
      createdAt: new Date().toISOString()
    }
  });
  alert("تم إرسال الإنذار وسيظهر فوراً في واجهة الطالب الرئيسية!");
};

// نشر تكليف رسمي من لوحة المشرف
document.getElementById("admin-assignment-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!isAdmin) return;
  await addDoc(collection(db, "supervisor_assignments"), {
    title: document.getElementById("admin-assignment-title").value.trim(),
    courseCode: document.getElementById("admin-assignment-course").value.trim(),
    dueDate: document.getElementById("admin-assignment-due-date").value,
    targetGender: document.getElementById("admin-assignment-gender").value,
    targetSection: document.getElementById("admin-assignment-section").value.trim(),
    details: document.getElementById("admin-assignment-details").value.trim(),
    createdAt: new Date().toISOString()
  });
  e.target.reset();
  alert("تم نشر التكليف الرسمي بنجاح!");
});

function updateAllCourseDropdowns() {
  const sel = document.getElementById("cram-course-select");
  if (!sel) return;
  sel.innerHTML = currentCourses.map(c => `<option value="${c.code}">${c.code} - ${c.name}</option>`).join("");
}

function renderHomeDashboardUI() {
  const now = new Date();
  document.getElementById("home-today-date-text").textContent = `📅 ${now.toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`;
}

// تسجيل الدخول والخروج القياسي
document.getElementById("btn-logout")?.addEventListener("click", () => signOut(auth));