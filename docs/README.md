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

##### Performance:
- I used a simple map to store UniqueContacts and prevent duplicate requests, but it could still cause performance issues with a large number of contacts inside of a loop.
  - We could first gather all contacts and then process them in batches.
- If we know and respect the rate limits of the API, we could, in theory, make (some of) the requests in parallel instead of sequentially.

#### Found Errors:
`generateLastModifiedDateFilter` function was using operator: 'GTQ' and 'LTQ' which are not valid operators.
Instead of `GTQ` and `LTQ`, it should use `GTE` (greater than or equal) and `LTE` (less than or equal).


### Execution Screenshots

Start of the execution:
![Start of the execution](Screenshot%202025-06-09%20at%2000.35.19.png)

> A bunch of actions are displayed in between...

End of the execution:
![End of the execution](Screenshot%202025-06-09%20at%2000.35.56.png)
