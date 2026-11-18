from pathlib import Path
from flask import Flask, render_template, abort 
import json
from accounts import init_accounts, current_user

app = Flask(__name__)
init_accounts(app)
LESSONS_DIR = Path(__file__).parent / "lessons"

def load_all_lessons():
	lessons = []
	for file in sorted(LESSONS_DIR.glob("*.json")):
		with open(file, encoding="utf-8") as f:
			lessons.append(json.load(f))
	return lessons 


def load_lesson(lesson_id):
	for lesson in load_all_lessons():
		if lesson["id"] == lesson_id:
			return lesson
	return None


@app.route("/")
def home():
	lessons = load_all_lessons()
	return render_template("home.html", lessons=lessons, signed_in=current_user() is not None)

@app.route("/lesson/<lesson_id>")
def lesson_page(lesson_id):
    lesson = load_lesson(lesson_id)
    if lesson is None: 
        abort(404)
    if lesson.get("requires_login") and current_user() is None: return render_template("locked.html", lesson=lesson), 403
    lessons = load_all_lessons()
    ids = [l["id"] for l in lessons]
    i = ids.index(lesson_id) + 1
    nxt = lessons[i] if i < len(lessons) else None
    return render_template("lesson.html", lesson=lesson, next_lesson=nxt)

@app.route("/flashcards")
def flashcards():
    return render_template("flashcards.html")


if __name__ == "__main__":
	app.run(debug=True, port=5001)
