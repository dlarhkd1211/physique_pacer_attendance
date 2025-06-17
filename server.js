const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { Octokit } = require('@octokit/rest');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static('public'));

// GitHub 설정 (환경변수로 설정 필요)
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER; // GitHub 사용자명 또는 조직명
const GITHUB_REPO = process.env.GITHUB_REPO;   // 레포지토리 이름
const DATA_FILE_PATH = 'data/attendance_data.json'; // 레포지토리 내 데이터 파일 경로

const LOCAL_DATA_FILE = 'attendance_data.json';
const BACKUP_DIR = 'backups';

const ROLE_REQUIREMENTS = {
  '운영진': { total: 0, wednesday: 0 },
  '페이서': { total: 3, wednesday: 0 },
  '페이서 강남': { total: 3, wednesday: 2 },
  '포토': { total: 1, wednesday: 0 }
};

// GitHub API 초기화
let octokit = null;
if (GITHUB_TOKEN) {
  octokit = new Octokit({
    auth: GITHUB_TOKEN,
  });
}

// 백업 디렉토리 생성
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR);
}

class GitHubAttendanceSystem {
  constructor() {
    this.data = {};
    this.lastSha = null; // GitHub 파일의 마지막 SHA
    this.isInitialized = false;
    this.initializeData();
  }

  async initializeData() {
    try {
      console.log('데이터 초기화 시작...');
      
      // GitHub에서 데이터 로드 시도
      if (await this.loadFromGitHub()) {
        console.log('GitHub에서 데이터를 성공적으로 로드했습니다.');
      } else {
        console.log('GitHub 로드 실패, 로컬 파일에서 로드 시도...');
        // GitHub 로드 실패 시 로컬 파일에서 로드
        this.loadFromLocal();
      }
      
      this.isInitialized = true;
      console.log('데이터 초기화 완료');
    } catch (error) {
      console.error('데이터 초기화 오류:', error);
      this.data = {};
      this.isInitialized = true;
    }
  }

  async waitForInitialization() {
    while (!this.isInitialized) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // GitHub에서 데이터 로드
  async loadFromGitHub() {
    if (!octokit || !GITHUB_OWNER || !GITHUB_REPO) {
      console.log('GitHub 설정이 없습니다. 로컬 모드로 실행합니다.');
      return false;
    }

    try {
      console.log(`GitHub에서 데이터 로드 중: ${GITHUB_OWNER}/${GITHUB_REPO}/${DATA_FILE_PATH}`);
      
      const response = await octokit.rest.repos.getContent({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: DATA_FILE_PATH,
      });

      if (response.data.content) {
        const content = Buffer.from(response.data.content, 'base64').toString('utf8');
        this.data = JSON.parse(content);
        this.lastSha = response.data.sha;
        
        // 로컬에도 백업 저장
        this.saveToLocal();
        
        console.log('GitHub에서 데이터 로드 성공');
        return true;
      }
    } catch (error) {
      if (error.status === 404) {
        console.log('GitHub에 데이터 파일이 없습니다. 새로 생성합니다.');
        this.data = {};
        await this.saveToGitHub('초기 데이터 파일 생성');
        return true;
      } else {
        console.error('GitHub 로드 오류:', error.message);
        return false;
      }
    }
    return false;
  }

  // 로컬 파일에서 데이터 로드
  loadFromLocal() {
    try {
      if (fs.existsSync(LOCAL_DATA_FILE)) {
        const rawData = fs.readFileSync(LOCAL_DATA_FILE, 'utf8');
        this.data = JSON.parse(rawData);
        console.log('로컬 파일에서 데이터 로드 성공');
      } else {
        console.log('로컬 데이터 파일이 없습니다. 빈 데이터로 시작합니다.');
        this.data = {};
      }
    } catch (error) {
      console.error('로컬 데이터 로드 오류:', error);
      this.data = {};
    }
  }

  // 로컬 파일에 저장
  saveToLocal() {
    try {
      fs.writeFileSync(LOCAL_DATA_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (error) {
      console.error('로컬 데이터 저장 오류:', error);
    }
  }

  // GitHub에 저장
  async saveToGitHub(commitMessage = '출석 데이터 업데이트') {
    if (!octokit || !GITHUB_OWNER || !GITHUB_REPO) {
      console.log('GitHub 설정이 없어 로컬에만 저장합니다.');
      this.saveToLocal();
      return false;
    }

    try {
      const content = JSON.stringify(this.data, null, 2);
      const contentBase64 = Buffer.from(content).toString('base64');

      const payload = {
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: DATA_FILE_PATH,
        message: `${commitMessage} - ${new Date().toLocaleString('ko-KR')}`,
        content: contentBase64,
      };

      // 기존 파일이 있으면 SHA 추가
      if (this.lastSha) {
        payload.sha = this.lastSha;
      }

      console.log('GitHub에 데이터 저장 중...');
      const response = await octokit.rest.repos.createOrUpdateFileContents(payload);
      
      this.lastSha = response.data.content.sha;
      this.saveToLocal(); // 로컬에도 백업
      
      console.log('GitHub 저장 성공:', response.data.commit.html_url);
      return true;
    } catch (error) {
      console.error('GitHub 저장 오류:', error.message);
      // GitHub 저장 실패 시 로컬에라도 저장
      this.saveToLocal();
      return false;
    }
  }

  // 데이터 저장 (GitHub + 로컬)
  async saveData(commitMessage = '출석 데이터 업데이트') {
    await this.saveToGitHub(commitMessage);
  }

  // 자동 백업 생성
  async createAutoBackup() {
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
      
      // GitHub에도 백업 저장
      if (octokit) {
        try {
          const content = JSON.stringify(backupData, null, 2);
          const contentBase64 = Buffer.from(content).toString('base64');
          
          await octokit.rest.repos.createOrUpdateFileContents({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: `backups/backup_${dateStr}_${timeStr}.json`,
            message: `자동 백업 - ${now.toLocaleString('ko-KR')}`,
            content: contentBase64,
          });
          
          console.log('GitHub 백업 저장 완료');
        } catch (error) {
          console.error('GitHub 백업 저장 오류:', error.message);
        }
      }
      
      // 30일 이상된 백업 파일 정리
      this.cleanOldBackups();
      
      return backupFileName;
    } catch (error) {
      console.error('자동 백업 생성 오류:', error);
      return null;
    }
  }

  // 수동 백업 생성
  async createManualBackup(description = '') {
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
      
      // GitHub에도 백업 저장
      if (octokit) {
        try {
          const content = JSON.stringify(backupData, null, 2);
          const contentBase64 = Buffer.from(content).toString('base64');
          
          await octokit.rest.repos.createOrUpdateFileContents({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: `backups/manual_backup_${dateStr}_${timeStr}${suffix}.json`,
            message: `수동 백업${description ? ': ' + description : ''} - ${now.toLocaleString('ko-KR')}`,
            content: contentBase64,
          });
          
          console.log('GitHub 수동 백업 저장 완료');
        } catch (error) {
          console.error('GitHub 수동 백업 저장 오류:', error.message);
        }
      }
      
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
  async restoreFromBackup(filename) {
    try {
      const filePath = path.join(BACKUP_DIR, filename);
      
      if (!fs.existsSync(filePath)) {
        return { success: false, error: '백업 파일을 찾을 수 없습니다.' };
      }
      
      const content = fs.readFileSync(filePath, 'utf8');
      const backupData = JSON.parse(content);
      
      // 복원 전 현재 데이터 백업
      await this.createManualBackup('복원_전_백업');
      
      // 데이터 복원
      this.data = backupData.data || {};
      await this.saveData('백업에서 데이터 복원');
      
      return { success: true, message: '데이터가 성공적으로 복원되었습니다.' };
    } catch (error) {
      console.error('백업 복원 오류:', error);
      return { success: false, error: '백업 복원 중 오류가 발생했습니다: ' + error.message };
    }
  }

  getMonthKey(year, month) {
    return year + '-' + (month < 10 ? '0' + month : month);
  }

  async initializeMonth(year, month) {
    const monthKey = this.getMonthKey(year, month);
    if (!this.data[monthKey]) {
      this.data[monthKey] = {};
      await this.saveData(`${year}년 ${month}월 초기화`);
    }
  }

  async addMember(year, month, name, role) {
    const monthKey = this.getMonthKey(year, month);
    await this.initializeMonth(year, month);
    
    if (!this.data[monthKey][name]) {
      this.data[monthKey][name] = {
        role: role,
        attendance: {},
        order: Object.keys(this.data[monthKey]).length
      };
      await this.saveData(`멤버 추가: ${name} (${role})`);
      return true;
    }
    return false;
  }

  async deleteMember(year, month, name) {
    const monthKey = this.getMonthKey(year, month);
    if (this.data[monthKey] && this.data[monthKey][name]) {
      delete this.data[monthKey][name];
      await this.saveData(`멤버 삭제: ${name}`);
      return true;
    }
    return false;
  }

  async updateMemberRole(year, month, name, newRole) {
    const monthKey = this.getMonthKey(year, month);
    if (this.data[monthKey] && this.data[monthKey][name]) {
      this.data[monthKey][name].role = newRole;
      await this.saveData(`${name} 역할 변경: ${newRole}`);
      return true;
    }
    return false;
  }

  async updateMemberOrder(year, month, memberOrders) {
    const monthKey = this.getMonthKey(year, month);
    if (this.data[monthKey]) {
      for (let i = 0; i < memberOrders.length; i++) {
        const memberOrder = memberOrders[i];
        if (this.data[monthKey][memberOrder.name]) {
          this.data[monthKey][memberOrder.name].order = memberOrder.order;
        }
      }
      await this.saveData('멤버 순서 변경');
      return true;
    }
    return false;
  }

  async copyFromPreviousMonth(year, month) {
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
      
      await this.saveData(`${prevYear}년 ${prevMonth}월 멤버 복사`);
      return true;
    }
    return false;
  }

  async updateAttendance(year, month, name, date, status) {
    const monthKey = this.getMonthKey(year, month);
    if (this.data[monthKey] && this.data[monthKey][name]) {
      this.data[monthKey][name].attendance[date] = parseInt(status);
      await this.saveData(`${name} 출석 업데이트 (${date})`);
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
  async importMonthData(year, month, importData) {
    try {
      const monthKey = this.getMonthKey(year, month);
      
      // 백업 생성 (덮어쓰기 전)
      await this.createManualBackup(`import_전_백업_${year}_${month}`);
      
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
      
      await this.saveData(`${year}년 ${month}월 데이터 가져오기`);
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

const attendanceSystem = new GitHubAttendanceSystem();

// 매일 자동 백업 실행 (매일 오전 2시)
const scheduleAutoBackup = () => {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(2, 0, 0, 0); // 오전 2시로 설정
  
  const timeUntilBackup = tomorrow.getTime() - now.getTime();
  
  setTimeout(async () => {
    await attendanceSystem.createAutoBackup();
    
    // 24시간마다 반복
    setInterval(async () => {
      await attendanceSystem.createAutoBackup();
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
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    github_connected: !!octokit,
    data_initialized: attendanceSystem.isInitialized
  });
});

// =============================================================================
// 기존 API 엔드포인트들 (async/await 적용)
// =============================================================================

app.get('/api/members/:year/:month', async (req, res) => {
  try {
    await attendanceSystem.waitForInitialization();
    
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

app.post('/api/add_member', async (req, res) => {
  try {
    await attendanceSystem.waitForInitialization();
    
    const { year, month, name, role } = req.body;
    
    if (!year || !month || !name || !role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (await attendanceSystem.addMember(year, month, name, role)) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Member already exists' });
    }
  } catch (error) {
    console.error('Error in /api/add_member:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/member/:year/:month/:name', async (req, res) => {
  try {
    await attendanceSystem.waitForInitialization();
    
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    const name = decodeURIComponent(req.params.name);
    
    if (await attendanceSystem.deleteMember(year, month, name)) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Failed to delete member' });
    }
  } catch (error) {
    console.error('Error in DELETE /api/member:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/member_role', async (req, res) => {
  try {
    await attendanceSystem.waitForInitialization();
    
    const { year, month, name, role } = req.body;
    
    if (!year || !month || !name || !role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (await attendanceSystem.updateMemberRole(year, month, name, role)) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Failed to update member role' });
    }
  } catch (error) {
    console.error('Error in /api/member_role:', error);
