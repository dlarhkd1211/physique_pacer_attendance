const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { Octokit } = require('@octokit/rest');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static('public'));

// GitHub 설정 (환경변수로 설정 필요)
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const DATA_FILE_PATH = 'data/attendance_data.json';

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
    this.lastSha = null;
    this.isInitialized = false;
    this.initializeData();
  }

  async initializeData() {
    try {
      console.log('데이터 초기화 시작...');
      
      if (await this.loadFromGitHub()) {
        console.log('GitHub에서 데이터를 성공적으로 로드했습니다.');
      } else {
        console.log('GitHub 로드 실패, 로컬 파일에서 로드 시도...');
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

  saveToLocal() {
    try {
      fs.writeFileSync(LOCAL_DATA_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (error) {
      console.error('로컬 데이터 저장 오류:', error);
    }
  }

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

      if (this.lastSha) {
        payload.sha = this.lastSha;
      }

      console.log('GitHub에 데이터 저장 중...');
      const response = await octokit.rest.repos.createOrUpdateFileContents(payload);
      
      this.lastSha = response.data.content.sha;
      this.saveToLocal();
      
      console.log('GitHub 저장 성공');
      return true;
    } catch (error) {
      console.error('GitHub 저장 오류:', error.message);
      this.saveToLocal();
      return false;
    }
  }

  async saveData(commitMessage = '출석 데이터 업데이트') {
    await this.saveToGitHub(commitMessage);
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
        extraAttendance: {},
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
          extraAttendance: {},
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
      // 기타 참여인지 확인 (extra1, extra2, extra3)
      if (date.startsWith('extra')) {
        if (!this.data[monthKey][name].extraAttendance) {
          this.data[monthKey][name].extraAttendance = {};
        }
        this.data[monthKey][name].extraAttendance[date] = parseInt(status);
        await this.saveData(`${name} 기타 참여 업데이트 (${date})`);
      } else {
        // 정규 날짜 출석
        this.data[monthKey][name].attendance[date] = parseInt(status);
        await this.saveData(`${name} 출석 업데이트 (${date})`);
      }
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
      return { 
        total: 0, 
        regular: 0,
        wednesday: 0, 
        extra: 0,
        extra1: 0,
        extra2: 0,
        extra3: 0,
        meets_requirement: false 
      };
    }
  
    const member = members[name];
    const role = member.role;
    const attendance = member.attendance;
    const extraAttendance = member.extraAttendance || {};
    
    const monthDates = this.getMonthDates(year, month);
    
    let totalAttendance = 0;
    let wednesdayAttendance = 0;
    let extraCount = 0;
    let extra1 = 0, extra2 = 0, extra3 = 0;
    
    // 정규 날짜 출석 계산
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
    
    // 기타 참여 계산
    for (let i = 1; i <= 3; i++) {
      if (extraAttendance['extra' + i] === 1) {
        extraCount++;
        if (i === 1) extra1 = 1;
        if (i === 2) extra2 = 1;
        if (i === 3) extra3 = 1;
      }
    }
    
    // 전체 출석 = 정규 출석 + 기타 참여
    const totalWithExtra = totalAttendance + extraCount;
    
    const requirements = ROLE_REQUIREMENTS[role] || { total: 0, wednesday: 0 };
    let meetsRequirement = true;
    
    if (role !== '운영진') {
      // 기타 참여 포함한 전체 출석으로 조건 확인
      if (totalWithExtra < requirements.total) {
        meetsRequirement = false;
      }
      if (wednesdayAttendance < requirements.wednesday) {
        meetsRequirement = false;
      }
    }
    
    return {
      total: totalWithExtra, // 기타 참여 포함한 전체
      regular: totalAttendance, // 정규 출석만
      wednesday: wednesdayAttendance,
      extra: extraCount,
      extra1: extra1,
      extra2: extra2,
      extra3: extra3,
      meets_requirement: meetsRequirement,
      required_total: requirements.total,
      required_wednesday: requirements.wednesday
    };
  }

  async importMonthData(year, month, importData) {
    try {
      const monthKey = this.getMonthKey(year, month);
      
      delete this.data[monthKey];
      this.data[monthKey] = {};
      
      if (importData.members) {
        const memberEntries = Object.keys(importData.members);
        
        for (let i = 0; i < memberEntries.length; i++) {
          const name = memberEntries[i];
          const memberData = importData.members[name];
          
          this.data[monthKey][name] = {
            role: memberData.role || '미정',
            attendance: memberData.attendance || {},
            extraAttendance: memberData.extraAttendance || {},
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

  exportAllData() {
    return {
      exportDate: new Date().toISOString(),
      version: '1.0',
      data: this.data
    };
  }

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
        attendance: {},
        extraAttendance: memberInfo.extraAttendance || {}
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

// API 엔드포인트들
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/member_orders', async (req, res) => {
  try {
    await attendanceSystem.waitForInitialization();
    
    const { year, month, orders } = req.body;
    
    if (!year || !month || !orders || !Array.isArray(orders)) {
      return res.status(400).json({ error: 'Missing required fields or invalid orders' });
    }
    
    if (await attendanceSystem.updateMemberOrder(year, month, orders)) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Failed to update member orders' });
    }
  } catch (error) {
    console.error('Error in /api/member_orders:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/copy_previous_month', async (req, res) => {
  try {
    await attendanceSystem.waitForInitialization();
    
    const { year, month } = req.body;
    
    if (!year || !month) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (await attendanceSystem.copyFromPreviousMonth(year, month)) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'No previous month data found or failed to copy' });
    }
  } catch (error) {
    console.error('Error in /api/copy_previous_month:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/attendance', async (req, res) => {
  try {
    await attendanceSystem.waitForInitialization();
    
    const { year, month, name, date, status } = req.body;
    
    if (!year || !month || !name || !date || status === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (await attendanceSystem.updateAttendance(year, month, name, date, status)) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Failed to update attendance' });
    }
  } catch (error) {
    console.error('Error in /api/attendance:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/monthly_report/:year/:month', async (req, res) => {
  try {
    await attendanceSystem.waitForInitialization();
    
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

app.get('/api/dates/:year/:month', async (req, res) => {
  try {
    await attendanceSystem.waitForInitialization();
    
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

app.get('/api/export/all', async (req, res) => {
  try {
    await attendanceSystem.waitForInitialization();
    
    const exportData = attendanceSystem.exportAllData();
    res.json(exportData);
  } catch (error) {
    console.error('Error in /api/export/all:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

app.get('/api/export/:year/:month', async (req, res) => {
  try {
    await attendanceSystem.waitForInitialization();
    
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

app.post('/api/import_month_data', async (req, res) => {
  try {
    await attendanceSystem.waitForInitialization();
    
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
    
    const result = await attendanceSystem.importMonthData(year, month, data);
    res.json(result);
  } catch (error) {
    console.error('Error in /api/import_month_data:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

app.get('/api/github/status', async (req, res) => {
  try {
    res.json({
      connected: !!octokit,
      owner: GITHUB_OWNER || null,
      repo: GITHUB_REPO || null,
      dataPath: DATA_FILE_PATH,
      lastSha: attendanceSystem.lastSha || null
    });
  } catch (error) {
    console.error('Error in /api/github/status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/github/sync', async (req, res) => {
  try {
    const success = await attendanceSystem.loadFromGitHub();
    
    if (success) {
      res.json({ 
        success: true, 
        message: 'GitHub에서 최신 데이터를 성공적으로 동기화했습니다.' 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: 'GitHub 동기화에 실패했습니다.' 
      });
    }
  } catch (error) {
    console.error('Error in /api/github/sync:', error);
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
  console.log(`GitHub 연결: ${!!octokit ? '연결됨' : '연결 안됨'}`);
  if (octokit) {
    console.log(`GitHub 저장소: ${GITHUB_OWNER}/${GITHUB_REPO}`);
    console.log(`GitHub 데이터 경로: ${DATA_FILE_PATH}`);
  }
});
