# DewTime - Time Tracking Desktop App/Widget

## Requirements
1. Support
  - *Top priority: Portable (windows and linux binaries) with local sqlite db
  - (future) Docker Server (web based) with default support for sqlite db and future support/env vars for external DBs (postgres, mariadb). Use case is multi user environment.
2. Local sqlite storage
3. Timers
  - Fields
    - user_id (use host username; future scalibility for multiple users)
    - Project #
    - Project Name
    - Timer Description
    - Timer Notes
    - Timer Timestamps
      - timestamp consists of a start datetime and end datetime pair
      - Zero or more timestamps per timer
      - When a timer is stopped the end datetime is set.
      - When a timer is started the start datetime is created and set and the end datetime is created but null until stopped
  - Only one timer running at a time
    - Starting a timer will auto-stop other running timers
  - Timer Management
    - Manage all timestamps for a given timer
    - ability to adjust start/end dates and time
  - Total Duration Offset
    - Ability to add a timer offset with a numeric value and units dropdown. E.g., offset timer  by -1 'hours'.
  - Copy to clipboard icons
    - Can copy the project #, project, description and total time to clipboard
4. Projects
  - Store project numbers and names in a table for future scaling on some project management features.
5. UI
  - Timers displayed in a tabular format
    - Each row shows the project number, project name, description, total running duration, start/stop button, notes icon, delete icon
    - Notes icon toggles a modal popup to write detailed notes on the timer
    - Start/stop button will say "Start" if the timer is not actively running and "Stop" if it is actively running.
    - Only show timers that the eariest timestamp start datetime is within a filtered date range
    - All fields are editable in place
      - Project numbers and names will be filterable dropdowns. The dropdown options are determined by project numbers or names used across all timers. Typing a project number or name will also provide an auto-suggestion on the closest match.
      - Clicking on the total timer duration will open the popup to manage all start/end timestamp pairs.
  - Above timers will be a date range control, icon to jump the date range to today, total duration for all filtered timers, and total duration for the week
    - Date range control defaults to the current day
    - Date range arrow icons shift the date range to the previous or next day. Clicking on the date range displays an calendar control that is overlayed and expands out below the date range (not a popup)
  - Button below timers table to quickly insert a new timer.
  - Settings page
    - Control week start/end. E.g., weeks start on Sunday and end on Saturday.
    - Open on system startup/login
    - Theme light/dark (default to dark)
