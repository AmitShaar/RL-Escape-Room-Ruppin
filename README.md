# פרויקט גמר: חדרי בריחה - למידה עם חיזוקים (Hizki In Space RL)

## מבוא

בפרויקט זה מוצגים חמישה "חדרים", כאשר בכל חדר מיושם אלגוריתם שונה של Reinforcement Learning. הסוכן הוא **חיזקי** - כלב בחליפת חלל שמחפש עצם בכל חדר.

- חדר 1 - Value Iteration (Dynamic Programming, Model-Based)
- חדר 2 - SARSA (On-Policy, Model-Free)
- חדר 3 - Q-Learning מול SARSA במקביל (Off-Policy, Model-Free)
- חדר 4 - DQN בסביבה רציפה (Deep Q-Network, Model-Free, Off-Policy)
- חדר 5 - Curriculum Learning + Q-Learning (גריד שגדל בהדרגה)

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
    room6_curriculum.py        # חדר 5 בממשק
  models/
    dqn_network.py             # רשת ה-Q של חדר 4

frontend/
  src/
    rooms/
      Room1_DP.jsx
      Room2_SARSA.jsx
      Room3_QLearning.jsx
      Room4_DQN.jsx
      Room6_Curriculum.jsx     # חדר 5 בממשק
    components/                # רכיבים משותפים (תלת-מימד, גרפים, היטמאפ, replay...)

docs/
  screenshots/                 # תמונת מסך אחת לכל חדר (room1.png ... room5.png)

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

לאחר מכן פותחים את הכתובת שמודפסת בטרמינל (בד"כ `http://localhost:5173`) בדפדפן. בראש המסך יש 5 לשוניות, אחת לכל חדר.

בכל חדר יש כפתורים:
- **Train** - מתחיל אימון לפי הפרמטרים שנבחרו בסליידרים
- **Pause / Resume** - להקפיא ולהמשיך אימון שכבר רץ
- **Reset** - לאפס את החדר (כולל מפה חדשה, אם רלוונטי)
- אחרי שהאימון מסתיים, יש **Replay** - סרגל שמשחק את הריצה הטובה ביותר, צעד-צעד

---

## מבנה המצבים ופונקציית התגמולים

### חדר 1 - Value Iteration
- **מצבים:** מיקום ברשת 10×10 + אילו פינוקים (treats) כבר נאספו. בלוח: קירות, תאים חלקלקים (vents), מלכודות-חתול (Cat Danger), חורים שחורים (מחזירים להתחלה בלי עונש), פינוקים, יציאה.
- **פעולות:** up / down / left / right, עם הסתברות החלקה (slip_prob) על תאים חלקלקים.
- **תגמולים:** treat_reward (פינוק), trap_reward (מלכודת-חתול), bone_reward (יציאה), עונש צעד קבוע.
- **פרמטרים:** gamma, slip_prob, treat_reward, trap_reward, bone_reward, מספר ריצות-replay, max_steps.

### חדר 2 - SARSA
- **מצבים:** מיקום ברשת 10×10 + כמה "תחנות" (beacons) ביקר בהן **בסדר הנכון** (חייב לבקר בהן בתור).
- **פעולות:** up / down / left / right לפי מדיניות ε-greedy.
- **תגמולים:** beacon_reward (תחנה בתור הנכון), trap_reward (מלכודת - מאפסת להתחלה), exit_reward (יציאה, רק אחרי כל התחנות), עונש צעד.
- **פרמטרים:** alpha, gamma, epsilon, episodes, max_steps, מהירות הדמיה.

### חדר 3 - Q-Learning מול SARSA
- **מצבים:** מיקום ברשת 10×10 + אילו חפצים (artifacts) נאספו (לא חשוב בסדר), כריש שנע במסלול קבוע, פורטל מקפיץ שמתגלה.
- **פעולות:** up / down / left / right לפי ε-greedy - מורצים **שני אלגוריתמים במקביל** (Q-Learning ו-SARSA) על אותה סביבה כדי להשוות ביניהם.
- **תגמולים:** fragment_reward (חפץ), shark_penalty (פגיעה בכריש - חזרה להתחלה), exit_reward, עונש צעד.
- **פרמטרים:** alpha, gamma, epsilon, episodes, max_steps, מהירות הדמיה.

### חדר 4 - DQN
- **מצבים:** רציפים - מיקום ומהירות (x, y, vx, vy), לא טבלה.
- **פעולות:** 9 כיווני דחיפה (שילובים של שמאל/ימין/בלי × מעלה/מטה/בלי).
- **תגמולים:** +100 הגעה ליעד (עיגול, לא משבצת), −10 פגיעה בקיר, −0.05 כל צעד אחר.
- **פרמטרים:** learning rate, gamma, epsilon, קצב דעיכת epsilon, episodes, max_steps.

### חדר 5 - Curriculum Learning
- **מצבים:** מיקום ברשת ש**גדלה בשלבים**: 4×4 → 6×6 → 10×10. קירות מתחדשים אקראית בכל שלב.
- **פעולות:** up / down / left / right לפי ε-greedy (Q-Learning).
- **תגמולים:** +100 יציאה, −0.1 כל צעד.
- **פרמטרים:** alpha, gamma, epsilon התחלתי, מהירות הדמיה.
- **הייחוד:** טבלת ה-Q **לא מתאפסת** בין שלבים - היא מועתקת לפינה של טבלה גדולה יותר, כדי שהידע יעבור לשלב הקשה יותר.
