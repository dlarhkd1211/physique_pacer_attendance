const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static('public'));

const DATA_FILE = 'attendance_data.json';

const ROLE_REQUIREMENTS = {
  '운영진': { total: 0, wednesday: 0 },
  '페이서': { total: 3, wednesday: 0 },
  '페이서 강남': { total: 3, wednesday: 2 },
  '포토': { total: 1, wednesday: 0 }
};

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
}

const attendanceSystem = new AttendanceSystem();

app.use(function(err, req, res, next) {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', function(req, res) {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/api/members/:year/:month', function(req, res) {
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

app.post('/api/add_member', function(req, res) {
  try {
    const year = req.body.year;
    const month = req.body.month;
    const name = req.body.name;
    const role = req.body.role;
    
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

app.delete('/api/member/:year/:month/:name', function(req, res) {
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

app.put('/api/member_role', function(req, res) {
  try {
    const year = req.body.year;
    const month = req.body.month;
    const name = req.body.name;
    const role = req.body.role;
    
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

app.put('/api/member_orders', function(req, res) {
  try {
    const year = req.body.year;
    const month = req.body.month;
    const orders = req.body.orders;
    
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

app.post('/api/copy_previous_month', function(req, res) {
  try {
    const year = req.body.year;
    const month = req.body.month;
    
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

app.post('/api/attendance', function(req, res) {
  try {
    const year = req.body.year;
    const month = req.body.month;
    const name = req.body.name;
    const date = req.body.date;
    const status = req.body.status;
    
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

app.get('/api/monthly_report/:year/:month', function(req, res) {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Invalid year or month' });
    }
    
    const members = attendanceSystem.getMonthMembers(year, month);
    const monthDates = attendanceSystem.getMonthDates(year, month);
    const report = {};
    
    const memberEntries = Object.keys(members);
    memberEntries.sort(function(a, b) {
      const orderA = members[a].order || 0;
      const orderB = members[b].order || 0;
      return orderA - orderB;
    });
    
    for (let i = 0; i < memberEntries.length; i++) {
      const name = memberEntries[i];
      const memberInfo = members[name];
      const stats = attendanceSystem.calculateMonthlyStats(year, month, name);
      
      report[name] = {
        role: memberInfo.role,
        order: memberInfo.order || 0,
        stats: stats,
        attendance: {}
      };
      
      for (let j = 0; j < monthDates.length; j++) {
        const dateStr = monthDates[j];
        report[name].attendance[dateStr] = memberInfo.attendance[dateStr] || 0;
      }
    }
    
    res.json({
      members: report,
      dates: monthDates
    });
  } catch (error) {
    console.error('Error in /api/monthly_report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/dates/:year/:month', function(req, res) {
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

app.use(function(req, res) {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, function() {
  console.log('출석 시스템이 포트 ' + PORT + '에서 실행 중입니다.');
  console.log('환경: ' + (process.env.NODE_ENV || 'development'));
});