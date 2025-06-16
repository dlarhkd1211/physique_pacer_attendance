const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static('public'));

const DATA_FILE = 'attendance_data.json';
const BACKUP_DIR = 'backups';

const ROLE_REQUIREMENTS = {
  '운영진': { total: 0, wednesday: 0 },
  '페이서': { total: 3, wednesday: 0 },
  '페이서 강남': { total: 3, wednesday: 2 },
  '포토': { total: 1, wednesday: 0 }
};

// 백업 디렉토리 생성
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR);
}

class AttendanceSystem {
  constructor() {
    this.data = this.loadData();
  }

  loadData() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const rawData = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(rawData);
      }
    } catch (error) {
      console.error('데이터 로드 오류:', error);
    }
    return {};
  }

  saveData() {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (error) {
      console.error('데이터 저장 오류:', error);
    }
  }

  // 자동 백업 (매일 실행)
  createAutoBackup() {
    try {
      const now = new Date();
      const dateStr = now.getFullYear() + '-' + 
                     String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                     String(now.getDate()).padStart(2, '0');
      const timeStr = String(now.getHours()).padStart(2, '0') + 
                     String(now.getMinutes()).padStart(2, '0');
      
      const backupFileName = path.join(BACKUP_DIR, `backup_${dateStr}_${timeStr}.json`);
      
      const backupData = {
        backupDate: now.toISOString(),
        data: this.data
      };
      
      fs.writeFileSync(backupFileName, JSON.stringify(backupData, null, 2), 'utf8');
      console.log('자동 백업 생성:', backupFileName);
      
      // 30일 이상된 백업 파일 정리
      this.cleanOldBackups();
      
      return backupFileName;
    } catch (error) {
      console.error('자동 백업 생성 오류:', error);
      return null;
    }
  }

  // 수동 백업 생성
  createManualBackup(description = '') {
    try {
      const now = new Date();
      const dateStr = now.getFullYear() + '-' + 
                     String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                     String(now.getDate()).padStart(2, '0');
      const timeStr = String(now.getHours()).padStart(2, '0') + 
                     String(now.getMinutes()).padStart(2, '0') + 
                     String(now.getSeconds()).padStart(2, '0');
      
      const suffix = description ? `_${description.replace(/[^a-zA-Z0-9가-힣]/g, '_')}` : '';
      const backupFileName = path.join(BACKUP_DIR, `manual_backup_${dateStr}_${timeStr}${suffix}.json`);
      
      const backupData = {
        backupDate: now.toISOString(),
        description: description,
        data: this.data
      };
      
      fs.writeFileSync(backupFileName, JSON.stringify(backupData, null, 2), 'utf8');
      console.log('수동 백업 생성:', backupFileName);
      
      return backupFileName;
    } catch (error) {
      console.error('수동 백업 생성 오류:', error);
      return null;
    }
  }

  // 오래된 백업 파일 정리 (30일 이상)
  cleanOldBackups() {
    try {
      const files = fs.readdirSync(BACKUP_DIR);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      let deletedCount = 0;
      files.forEach(file => {
        if (file.startsWith('backup_') && file.endsWith('.json')) {
          const filePath = path.join(BACKUP_DIR, file);
          const stats = fs.statSync(filePath);
          
          if (stats.mtime < thirtyDaysAgo) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        }
      });
      
      if (deletedCount > 0) {
        console.log(`${deletedCount}개의 오래된 백업 파일을 삭제했습니다.`);
      }
    } catch (error) {
      console.error('백업 파일 정리 오류:', error);
    }
  }

  // 백업 목록 조회
  getBackupList() {
    try {
      const files = fs.readdirSync(BACKUP_DIR);
      const backups = [];
      
      files.forEach(file => {
        if (file.endsWith('.json')) {
          const filePath = path.join(BACKUP_DIR, file);
          const stats = fs.statSync(filePath);
          
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            const backupData = JSON.parse(content);
            
            backups.push({
              filename: file,
              backupDate: backupData.backupDate || stats.mtime.toISOString(),
              description: backupData.description || '',
              size: stats.size,
              isManual: file.startsWith('manual_')
            });
          } catch (parseError) {
            console.error('백업 파일 파싱 오류:', file, parseError);
          }
        }
      });
      
      // 날짜 순 정렬 (최신순)
      backups.sort((a, b) => new Date(b.backupDate) - new Date(a.backupDate));
      
      return backups;
    } catch (error) {
      console.error('백업 목록 조회 오류:', error);
      return [];
    }
  }

  // 백업에서 복원
  restoreFromBackup(filename) {
    try {
      const filePath = path.join(BACKUP_DIR, filename);
      
      if (!fs.existsSync(filePath)) {
        return { success: false, error: '백업 파일을 찾을 수 없습니다.' };
      }
      
      const content = fs.readFileSync(filePath, 'utf8');
      const backupData = JSON.parse(content);
      
      // 복원 전 현재 데이터 백업
      this.createManualBackup('복원_전_백업');
      
      // 데이터 복원
      this.data = backupData.data || {};
      this.saveData();
      
      return { success: true, message: '데이터가 성공적으로 복원되었습니다.' };
    } catch (error) {
      console.error('백업 복원 오류:', error);
      return { success: false, error: '백업 복원 중 오류가 발생했습니다: ' + error.message };
    }
  }

  getMonthKey(year, month) {
    return year + '-' + (month < 10 ? '0' + month : month);
  }

  initializeMonth(year, month) {
    const monthKey = this.getMonthKey(year, month);
    if (!this.data[monthKey]) {
      this.data[monthKey] = {};
      this.saveData();
    }
  }

  addMember(year, month, name, role) {
    const monthKey = this.getMonthKey(year, month);
    this.initializeMonth(year, month);
    
    if (!this.data[monthKey][name]) {
      this.data[monthKey][name] = {
        role: role,
        attendance: {},
        order: Object.keys(this.data[monthKey]).length
      };
      this.saveData();
      return true;
    }
    return false;
  }

  deleteMember(year, month, name) {
    const monthKey = this.getMonthKey(year, month);
    if (this.data[monthKey] && this.data[monthKey][name]) {
      delete this.data[monthKey][name];
      this.saveData();
      return true;
    }
    return false;
  }

  updateMemberRole(year, month, name, newRole) {
    const monthKey = this.getMonthKey(year, month);
    if (this.data[monthKey] && this.data[monthKey][name]) {
      this.data[monthKey][name].role = newRole;
      this.saveData();
      return true;
    }
    return false;
  }

  updateMemberOrder(year, month, memberOrders) {
    const monthKey = this.getMonthKey(year, month);
    if (this.data[monthKey]) {
      for (let i = 0; i < memberOrders.length; i++) {
        const memberOrder = memberOrders[i];
        if (this.data[monthKey][memberOrder.name]) {
          this.data[monthKey][memberOrder.name].order = memberOrder.order;
        }
      }
      this.saveData();
      return true;
    }
    return false;
  }

  copyFromPreviousMonth(year, month) {
    const currentMonthKey = this.getMonthKey(year, month);
    let prevYear = year;
    let prevMonth = month - 1;
    
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear = year - 1;
    }
    
    const prevMonthKey = this.getMonthKey(prevYear, prevMonth);
    
    if (this.data[prevMonthKey]) {
      this.data[currentMonthKey] = {};
      
      const prevMembers = Object.keys(this.data[prevMonthKey]);
      for (let i = 0; i < prevMembers.length; i++) {
        const name = prevMembers[i];
        const memberData = this.data[prevMonthKey][name];
        this.data[currentMonthKey][name] = {
          role: memberData.role,
          attendance: {},
          order: memberData.order
        };
      }
      
      this.saveData();
      return true;
    }
    return false;
  }

  updateAttendance(year, month, name, date, status) {
    const monthKey = this.getMonthKey(year, month);
    if (this.data[monthKey] && this.data[monthKey][name]) {
      this.data[monthKey][name].attendance[date] = parseInt(status);
      this.saveData();
      return true;
    }
    return false;
  }

  getMonthMembers(year, month) {
    const monthKey = this.getMonthKey(year, month);
    return this.data[monthKey] || {};
  }

  getMonthDates(year, month) {
    const dates = [];
    const date = new Date(year, month - 1, 1);
    
    while (date.getMonth() === month - 1) {
      const weekday = date.getDay();
      if (weekday === 1 || weekday === 3 || weekday === 4) {
        dates.push(date.toISOString().split('T')[0]);
      }
      date.setDate(date.getDate() + 1);
    }
    
    return dates;
  }

  calculateMonthlyStats(year, month, name) {
    const monthKey = this.getMonthKey(year, month);
    const members = this.data[monthKey] || {};
    
    if (!members[name]) {
      return { total: 0, wednesday: 0, meets_requirement: false };
    }

    const member = members[name];
    const role = member.role;
    const attendance = member.attendance;
    
    const monthDates = this.getMonthDates(year, month);
    
    let totalAttendance = 0;
    let wednesdayAttendance = 0;
    
    for (let i = 0; i < monthDates.length; i++) {
      const dateStr = monthDates[i];
      if (attendance[dateStr] === 1) {
        totalAttendance++;
        
        const dateObj = new Date(dateStr);
        if (dateObj.getDay() === 3) {
          wednesdayAttendance++;
        }
      }
    }
    
    const requirements = ROLE_REQUIREMENTS[role] || { total: 0, wednesday: 0 };
    let meetsRequirement = true;
    
    if (role !== '운영진') {
      if (totalAttendance < requirements.total) {
        meetsRequirement = false;
      }
      if (wednesdayAttendance < requirements.wednesday) {
        meetsRequirement = false;
      }
    }
    
    return {
      total: totalAttendance,
      wednesday: wednesdayAttendance,
      meets_requirement: meetsRequirement,
      required_total: requirements.total,
      required_wednesday: requirements.wednesday
    };
  }

  // 월 데이터 import (덮어쓰기)
  importMonthData(year, month, importData) {
    try {
      const monthKey = this.getMonthKey(year, month);
      
      // 백업 생성 (덮어쓰기 전)
      this.createManualBackup(`import_전_백업_${year}_${month}`);
      
      // 기존 데이터 삭제
      delete this.data[monthKey];
      
      // 새 데이터 구성
      this.data[monthKey] = {};
      
      if (importData.members) {
        const memberEntries = Object.keys(importData.members);
        
        for (let i = 0; i < memberEntries.length; i++) {
          const name = memberEntries[i];
          const memberData = importData.members[name];
          
          this.data[monthKey][name] = {
            role: memberData.role || '미정',
            attendance: memberData.attendance || {},
            order: memberData.order !== undefined ? memberData.order : i
          };
        }
      }
      
      this.saveData();
      return { success: true, message: '데이터를 성공적으로 가져왔습니다.' };
    } catch (error) {
      console.error('월 데이터 import 오류:', error);
      return { success: false, error: '데이터 가져오기 중 오류가 발생했습니다: ' + error.message };
    }
  }

  // 전체 데이터 export
  exportAllData() {
    return {
      exportDate: new Date().toISOString(),
      version: '1.0',
      data: this.data
    };
  }

  // 특정 월 데이터 export
  exportMonthData(year, month) {
    const monthKey = this.getMonthKey(year, month);
    const members = this.getMonthMembers(year, month);
    const dates = this.getMonthDates(year, month);
    
    const report = {};
    const memberEntries = Object.keys(members);
    memberEntries.sort((a, b) => {
      const orderA = members[a].order || 0;
      const orderB = members[b].order || 0;
      return orderA - orderB;
    });
    
    for (let i = 0; i < memberEntries.length; i++) {
      const name = memberEntries[i];
      const memberInfo = members[name];
      const stats = this.calculateMonthlyStats(year, month, name);
      
      report[name] = {
        role: memberInfo.role,
        order: memberInfo.order || 0,
        stats: stats,
        attendance: {}
      };
      
      for (let j = 0; j < dates.length; j++) {
        const dateStr = dates[j];
        report[name].attendance[dateStr] = memberInfo.attendance[dateStr] || 0;
      }
    }
    
    return {
      exportDate: new Date().toISOString(),
      year: year,
      month: month,
      members: report,
      dates: dates
    };
  }
}

const attendanceSystem = new AttendanceSystem();

// 매일 자동 백업 실행 (매일 오전 2시)
const scheduleAutoBackup = () => {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(2, 0, 0, 0); // 오전 2시로 설정
  
  const timeUntilBackup = tomorrow.getTime() - now.getTime();
  
  setTimeout(() => {
    attendanceSystem.createAutoBackup();
    
    // 24시간마다 반복
    setInterval(() => {
      attendanceSystem.createAutoBackup();
    }, 24 * 60 * 60 * 1000);
  }, timeUntilBackup);
  
  console.log('자동 백업이 예약되었습니다. 다음 백업:', tomorrow.toLocaleString('ko-KR'));
};

// 서버 시작 시 자동 백업 스케줄링
scheduleAutoBackup();

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// =============================================================================
// 기존 API 엔드포인트들
// =============================================================================

app.get('/api/members/:year/:month', (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Invalid year or month' });
    }
    
    const members = attendanceSystem.getMonthMembers(year, month);
    res.json(members);
  } catch (error) {
    console.error('Error in /api/members:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/add_member', (req, res) => {
  try {
    const { year, month, name, role } = req.body;
    
    if (!year || !month || !name || !role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (attendanceSystem.addMember(year, month, name, role)) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Member already exists' });
    }
  } catch (error) {
    console.error('Error in /api/add_member:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/member/:year/:month/:name', (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    const name = decodeURIComponent(req.params.name);
    
    if (attendanceSystem.deleteMember(year, month, name)) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Failed to delete member' });
    }
  } catch (error) {
    console.error('Error in DELETE /api/member:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/member_role', (req, res) => {
  try {
    const { year, month, name, role } = req.body;
    
    if (!year || !month || !name || !role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (attendanceSystem.updateMemberRole(year, month, name, role)) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Failed to update member role' });
    }
  } catch (error) {
    console.error('Error in /api/member_role:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/member_orders', (req, res) => {
  try {
    const { year, month, orders } = req.body;
    
    if (!year || !month || !orders || !Array.isArray(orders)) {
      return res.status(400).json({ error: 'Missing required fields or invalid orders' });
    }
    
    if (attendanceSystem.updateMemberOrder(year, month, orders)) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Failed to update member orders' });
    }
  } catch (error) {
    console.error('Error in /api/member_orders:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/copy_previous_month', (req, res) => {
  try {
    const { year, month } = req.body;
    
    if (!year || !month) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (attendanceSystem.copyFromPreviousMonth(year, month)) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'No previous month data found or failed to copy' });
    }
  } catch (error) {
    console.error('Error in /api/copy_previous_month:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/attendance', (req, res) => {
  try {
    const { year, month, name, date, status } = req.body;
    
    if (!year || !month || !name || !date || status === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (attendanceSystem.updateAttendance(year, month, name, date, status)) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Failed to update attendance' });
    }
  } catch (error) {
    console.error('Error in /api/attendance:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/monthly_report/:year/:month', (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Invalid year or month' });
    }
    
    const reportData = attendanceSystem.exportMonthData(year, month);
    res.json(reportData);
  } catch (error) {
    console.error('Error in /api/monthly_report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/dates/:year/:month', (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Invalid year or month' });
    }
    
    const dates = attendanceSystem.getMonthDates(year, month);
    res.json(dates);
  } catch (error) {
    console.error('Error in /api/dates:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =============================================================================
// 새로운 Export/Backup API 엔드포인트들
// =============================================================================

// 전체 데이터 export
app.get('/api/export/all', (req, res) => {
  try {
    const exportData = attendanceSystem.exportAllData();
    res.json(exportData);
  } catch (error) {
    console.error('Error in /api/export/all:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// 특정 월 데이터 export
app.get('/api/export/:year/:month', (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Invalid year or month' });
    }
    
    const exportData = attendanceSystem.exportMonthData(year, month);
    res.json(exportData);
  } catch (error) {
    console.error('Error in /api/export:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// 수동 백업 생성
app.post('/api/backup/create', (req, res) => {
  try {
    const { description } = req.body;
    const backupFile = attendanceSystem.createManualBackup(description || '');
    
    if (backupFile) {
      res.json({ 
        success: true, 
        filename: path.basename(backupFile),
        message: '백업이 성공적으로 생성되었습니다.' 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: '백업 생성에 실패했습니다.' 
      });
    }
  } catch (error) {
    console.error('Error in /api/backup/create:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

// 백업 목록 조회
app.get('/api/backup/list', (req, res) => {
  try {
    const backups = attendanceSystem.getBackupList();
    res.json({ success: true, backups: backups });
  } catch (error) {
    console.error('Error in /api/backup/list:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get backup list' 
    });
  }
});

// 백업에서 복원
app.post('/api/backup/restore', (req, res) => {
  try {
    const { filename } = req.body;
    
    if (!filename) {
      return res.status(400).json({ 
        success: false, 
        error: 'Filename is required' 
      });
    }
    
    const result = attendanceSystem.restoreFromBackup(filename);
    res.json(result);
  } catch (error) {
    console.error('Error in /api/backup/restore:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

// 백업 파일 다운로드
app.get('/api/backup/download/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(BACKUP_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Backup file not found' });
    }
    
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error('Error downloading backup:', err);
        res.status(500).json({ error: 'Failed to download backup' });
      }
    });
  } catch (error) {
    console.error('Error in /api/backup/download:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 백업 파일 삭제
app.delete('/api/backup/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(BACKUP_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ 
        success: false, 
        error: 'Backup file not found' 
      });
    }
    
    // 자동 백업 파일만 삭제 가능 (수동 백업은 보호)
    if (!filename.startsWith('backup_')) {
      return res.status(403).json({ 
        success: false, 
        error: 'Cannot delete manual backup files' 
      });
    }
    
    fs.unlinkSync(filePath);
    res.json({ 
      success: true, 
      message: 'Backup file deleted successfully' 
    });
  } catch (error) {
    console.error('Error in DELETE /api/backup:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

// 월 데이터 import
app.post('/api/import_month_data', (req, res) => {
  try {
    const { year, month, data } = req.body;
    
    if (!year || !month || !data) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }
    
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid year or month' 
      });
    }
    
    const result = attendanceSystem.importMonthData(year, month, data);
    res.json(result);
  } catch (error) {
    console.error('Error in /api/import_month_data:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`출석 시스템이 포트 ${PORT}에서 실행 중입니다.`);
  console.log(`환경: ${process.env.NODE_ENV || 'development'}`);
  console.log(`데이터 파일: ${DATA_FILE}`);
  console.log(`백업 디렉토리: ${BACKUP_DIR}`);
});
