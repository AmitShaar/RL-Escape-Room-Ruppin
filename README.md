# פרויקט גמר: חדרי בריחה - למידה עם חיזוקים (Hizki In Space RL)

## מבוא

בפרויקט זה מוצגים שישה "חדרים", כאשר בכל חדר מיושם אלגוריתם שונה של Reinforcement Learning. הסוכן הוא **חיזקי** - כלב בחליפת חלל שמחפש עצם בכל חדר.

- חדר 1 - Value Iteration (Dynamic Programming, Model-Based)
- חדר 2 - SARSA (On-Policy, Model-Free)
- חדר 3 - Q-Learning מול SARSA במקביל (Off-Policy, Model-Free)
- חדר 4 - DQN בסביבה רציפה עם מהירות דיסקרטית (Deep Q-Network, Off-Policy)
- חדר 5 - DQN + מכשולים דינמיים + Partial Observation (The Storm)
- חדר 6 - Curriculum Learning + Q-Learning (גריד שגדל בהדרגה)

## גישה לאפליקציה

**[https://rl-escape-room-ruppin.vercel.app/](https://rl-escape-room-ruppin.vercel.app/)**

---

מטרת הקובץ: להסביר את מבנה המצבים בכל חדר, את פונקציית התגמולים, ואת הפרמטרים שאפשר לשנות מתוך המסך.

---

## רשימת קבצים ותיקיות

```
backend/
  main.py                      # שרת FastAPI + WebSocket, מנתב כל חדר
  rooms/
    room1_dp.py
    room2_sarsa.py
    room3_qlearning.py
    room4_dqn.py
    room5_storm.py             # חדר 5 - DQN + מכשולים דינמיים
    room6_curriculum.py        # חדר 6 - Curriculum Learning
  models/
    dqn_network.py             # רשת ה-Q של חדרים 4 ו-5

frontend/
  src/
    rooms/
      Room1_DP.jsx
      Room2_SARSA.jsx
      Room3_QLearning.jsx
      Room4_DQN.jsx
      Room5_Storm.jsx            # חדר 5 - DQN + מכשולים דינמיים
      Room6_Curriculum.jsx       # חדר 6 - Curriculum Learning
    components/                # רכיבים משותפים (תלת-מימד, גרפים, היטמאפ, replay...)

docs/
  screenshots/                 # תמונת מסך אחת לכל חדר (room1.png ... room6.png)
  videos/
    room4.webm                 # סרטון הדגמה לחדר 4 (DQN)

README.md
```

---

## הוראות הרצה

הפרויקט מורכב משרת (backend בפייתון) ולקוח (frontend בדפדפן) - יש להריץ את שניהם במקביל.

**שרת:**
```bash
cd backend
python -m venv venv
./venv/Scripts/python.exe -m pip install -r requirements.txt
./venv/Scripts/python.exe main.py
```

**לקוח (בחלון טרמינל נוסף):**
```bash
cd frontend
npm install
npm run dev
```

לאחר מכן פותחים את הכתובת שמודפסת בטרמינל (בד"כ `http://localhost:5173`) בדפדפן. בראש המסך יש 6 לשוניות, אחת לכל חדר.

בכל חדר יש כפתורים:
- **Train** - מתחיל אימון לפי הפרמטרים שנבחרו בסליידרים
- **Pause / Resume** - להקפיא ולהמשיך אימון שכבר רץ
- **Reset** - לאפס את החדר (כולל מפה חדשה, אם רלוונטי)
- אחרי שהאימון מסתיים, יש **Replay** - סרגל שמשחק את הריצה הטובה ביותר, צעד-צעד

---

## מבנה המצבים ופונקציית התגמולים

### חדר 1 - Value Iteration

![חדר 1 - Value Iteration](docs/screenshots/room1.png)

- **מצבים:** מיקום ברשת 10×10 + אילו פינוקים (treats) כבר נאספו. בלוח: קירות, תאים חלקלקים (vents), מלכודות-חתול (Cat Danger), חורים שחורים (מחזירים להתחלה בלי עונש), פינוקים, יציאה.
- **פעולות:** up / down / left / right, עם הסתברות החלקה (slip_prob) על תאים חלקלקים.
- **תגמולים:** treat_reward (פינוק), trap_reward (מלכודת-חתול), bone_reward (יציאה), עונש צעד קבוע.
- **פרמטרים:** gamma, slip_prob, treat_reward, trap_reward, bone_reward, מספר ריצות-replay, max_steps.

---

### חדר 2 - SARSA

![חדר 2 - SARSA](docs/screenshots/room2.png)

- **מצבים:** מיקום ברשת 10×10 + כמה "תחנות" (beacons) ביקר בהן **בסדר הנכון** (חייב לבקר בהן בתור).
- **פעולות:** up / down / left / right לפי מדיניות ε-greedy.
- **תגמולים:** beacon_reward (תחנה בתור הנכון), trap_reward (מלכודת - מאפסת להתחלה), exit_reward (יציאה, רק אחרי כל התחנות), עונש צעד.
- **פרמטרים:** alpha, gamma, epsilon, episodes, max_steps, מהירות הדמיה.

---

### חדר 3 - Q-Learning מול SARSA

![חדר 3 - Q-Learning](docs/screenshots/room3.png)

- **מצבים:** מיקום ברשת 10×10 + אילו חפצים (artifacts) נאספו (לא חשוב בסדר), כריש שנע במסלול קבוע, פורטל מקפיץ שמתגלה.
- **פעולות:** up / down / left / right לפי ε-greedy - מורצים **שני אלגוריתמים במקביל** (Q-Learning ו-SARSA) על אותה סביבה כדי להשוות ביניהם.
- **תגמולים:** fragment_reward (חפץ), shark_penalty (פגיעה בכריש - חזרה להתחלה), exit_reward, עונש צעד.
- **פרמטרים:** alpha, gamma, epsilon, episodes, max_steps, מהירות הדמיה.

---

### חדר 4 - DQN

![חדר 4 - DQN](docs/screenshots/room4.png)

> **הדגמת אימון — חיזקי לומד לנווט בסביבה רציפה:**

https://github.com/user-attachments/assets/c23db440-875b-4eb3-86d0-3b98435a40aa

- **מצבים:** רציפים - מיקום ומהירות (x, y, vx, vy). מהירות **דיסקרטית** {−1, 0, 1} בכל ציר — הפעולה IS המהירות (ללא accumulation/drag), תואם לספק.
- **פעולות:** 9 כיווני דחיפה (שילובים של {−1,0,1} × {−1,0,1}).
- **תגמולים:** +100 הגעה ליעד (עיגול), −10 פגיעה בקיר, −0.05 כל צעד אחר.
- **פרמטרים:** learning rate, gamma, epsilon, קצב דעיכת epsilon, episodes, max_steps.

---

### חדר 5 - DQN + מכשולים דינמיים (The Storm)

![חדר 5 - The Storm](docs/screenshots/room5.png)

- **מצבים:** (x, y, vx, vy) רציפים + מרחקים ל-K המכשולים הקרובים ביותר בטווח ראייה X מ'. מכשולים מחוץ לטווח מקבלים sentinel קבוע, כך שממד ה-state נשאר קבוע.
- **פעולות:** 9 כיווני דחיפה (thrust), פיזיקה עם momentum ו-drag.
- **תגמולים:** +100 יציאה, −20 התנגשות במכשול (terminal), −10 פגיעה בקיר, −0.05 צעד + potential-based shaping (gradient לכיוון היציאה).
- **ייחוד:** כמות ומיקום המכשולים **רנדומליים** בכל אפיזודה. בסוף האימון — כפתור "Test on new layout" מריץ 10 בדיקות על מפות **שהסוכן מעולם לא ראה**, ומדווח שיעור הצלחה.
- **פרמטרים:** learning rate, gamma, epsilon, epsilon decay, episodes, max steps, N obstacles, visibility range.

---

### חדר 6 - Curriculum Learning

![חדר 6 - Curriculum Learning](docs/screenshots/room6.png)

- **מצבים:** מיקום ברשת ש**גדלה בשלבים**: 4×4 → 6×6 → 10×10. קירות מתחדשים אקראית בכל שלב.
- **פעולות:** up / down / left / right לפי ε-greedy (Q-Learning).
- **תגמולים:** +100 יציאה, −0.1 כל צעד.
- **פרמטרים:** alpha, gamma, epsilon התחלתי, מהירות הדמיה.
- **הייחוד:** טבלת ה-Q **לא מתאפסת** בין שלבים — מועתקת לפינה של טבלה גדולה יותר, כדי שהידע מהשלב הקל יעבור לשלב הקשה.
