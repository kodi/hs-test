### Debrief

#### Possible Improvements

##### Code Quality And Readability:

- The code could benefit from more comments explaining the purpose of each function and the overall flow of the script.
- Various process functions could use centralized data fetching and processing functions to reduce redundancy.
- The error handling could be improved to provide more informative messages and handle specific cases more gracefully.
- user should be notified on backoff and retry attempts.

##### Project architecture:

- The project could be structured into modules to separate concerns, such as data fetching, processing, and error handling.
- Using a configuration file for API endpoints and other constants would make the code cleaner and easier to maintain.
- When implementing this in real-world scenario, we would probably split the code into multiple files, e.g. `processContacts.js`, `processCompanies.js`, etc., and have a main file that orchestrates the execution of these functions.

##### Performance:

- I used a simple map to store UniqueContacts and prevent duplicate requests, but it could still cause performance issues with a large number of contacts inside of a loop.
  - We could first gather all contacts and then process them in batches.
  - We could also use global index to store contacts from `processContacts` function and then use it in `processMeetings` function to avoid duplicate requests.
- If we know and respect the rate limits of the API, we could, in theory, make (some of) the requests in parallel instead of sequentially, but then indexing and deduplication would become more complex.

#### Found Errors:

`generateLastModifiedDateFilter` function was using operator: 'GTQ' and 'LTQ' which are not valid operators.
Instead of `GTQ` and `LTQ`, it should use `GTE` (greater than or equal) and `LTE` (less than or equal).

`processCompanies` had bug with (??) `actionDate` property, where by substracting `-2000` from the date it was causing the date to be casted to a timestamp, which was different from the format `processContacts` was using.
I unified the dates, so that all of the process functions are using the same format

### Execution Screenshots

Start of the execution:
![Start of the execution](Screenshot%202025-06-09%20at%2000.35.19.png)

> A bunch of actions are displayed in between...

End of the execution:
![End of the execution](Screenshot%202025-06-09%20at%2000.35.56.png)
