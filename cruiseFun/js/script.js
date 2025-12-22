document.addEventListener('DOMContentLoaded', () => {
    // Check if Firebase is available (initialized in index.html)
    if (typeof firebase === 'undefined' || typeof db === 'undefined') {
        console.error("Firebase is not initialized. Check your index.html script tags.");
        return;
    }

    // --- Configuration ---
    const USERS = ["Abe", "Ciara", "Chris", "Bryce", "Evan", "Allen", "Koda"];
    let CURRENT_USER = USERS[0];
    // eventIdCounter is no longer strictly needed as Firestore generates IDs, but kept for context.
    // let eventIdCounter = 100;
    
    // The events data will now be stored in this array, populated by Firestore
    let LIVE_EVENTS = []; 
    
    // --- DOM Elements ---
    const tabLinks = document.querySelectorAll('.tabs-nav .tab-link');
    const tabContents = document.querySelectorAll('.tab-content');
    const userSelect = document.getElementById('current-user-select');
    const eventsListContainer = document.getElementById('events-list');
    const addEventBtn = document.getElementById('add-event-btn');
    const addEventForm = document.getElementById('add-event-form');
    const cancelEventBtn = document.getElementById('cancel-event-btn');

    // --- Utility Functions ---

    /**
     * Creates the HTML string for an event card.
     */
    const createEventCardHTML = (event) => {
        // Find the current user's vote status for styling
        const isYes = event.votes.yes.includes(CURRENT_USER) ? ' selected' : '';
        const isNo = event.votes.no.includes(CURRENT_USER) ? ' selected' : '';

        return `
            <div class="event-card">
                <button class="delete-event-btn" data-event-id="${event.id}">❌ Delete</button>
                <button class="view-votes-btn" data-event-id="${event.id}">View Other Votes</button>
                <h3>${event.title}</h3>
                <p><strong>Time:</strong> ${event.time}</p>
                <p><strong>Location:</strong> ${event.location}</p>
                
                <div class="group-poll" data-event-id="${event.id}">
                    <p class="poll-prompt">Will you be attending?</p>
                    <div class="poll-options">
                        <button class="poll-btn yes-btn${isYes}" data-vote="yes">
                            ✅ Yes (<span class="count-yes">${event.votes.yes.length}</span>)
                        </button>
                        <button class="poll-btn no-btn${isNo}" data-vote="no">
                            ❌ No (<span class="count-no">${event.votes.no.length}</span>)
                        </button>
                    </div>
                    <div class="poll-results hidden" data-visible="false" style="display: none;">
                        <p class="yes-attendees"><strong>Attending (${event.votes.yes.length}):</strong> ${event.votes.yes.sort().join(', ')}</p>
                        <p class="no-attendees"><strong>Not Attending (${event.votes.no.length}):</strong> ${event.votes.no.sort().join(', ')}</p>
                    </div>
                </div>
            </div>
        `;
    };

    // --- DATABASE INTERACTION FUNCTIONS ---

    /**
     * Handles vote updates and writes to Firestore.
     */
    const handleVoteUpdate = async (eventObj, voteType, oppositeType) => {
        const docRef = db.collection('events').doc(eventObj.id);
        
        const updateData = {};

        // 1. Remove user from the opposite category
        updateData[`votes.${oppositeType}`] = firebase.firestore.FieldValue.arrayRemove(CURRENT_USER);
        
        // 2. Add user to the current category 
        updateData[`votes.${voteType}`] = firebase.firestore.FieldValue.arrayUnion(CURRENT_USER);

        try {
            await docRef.update(updateData);
        } catch (error) {
            console.error("Error updating vote:", error);
        }
    };

    /**
     * Deletes an event document from Firestore.
     */
    const deleteEventFromDB = async (eventIdToDelete) => {
        try {
            await db.collection('events').doc(eventIdToDelete).delete();
        } catch (error) {
            console.error("Error deleting event:", error);
            alert("Failed to delete event. Check console for details.");
        }
    };
    
    /**
     * Adds a new event document to Firestore.
     */
    const addNewEventToDB = async (newEventData) => {
        try {
            await db.collection('events').add(newEventData);
        } catch (error) {
            console.error("Error adding new event:", error);
            alert("Failed to add new event. Check console for details.");
        }
    };
    
    // --- RENDER FUNCTION ---

    /**
     * Renders all events in the LIVE_EVENTS array, grouped and sorted by day.
     */
    const renderAllEvents = () => {
        eventsListContainer.innerHTML = ''; // Clear the container for fresh render
        
        // Group and sort the live data
        const eventsByDay = LIVE_EVENTS.reduce((acc, event) => {
            if (!acc[event.day]) acc[event.day] = [];
            acc[event.day].push(event);
            return acc;
        }, {});

        const sortedDays = Object.keys(eventsByDay).sort();

        sortedDays.forEach(day => {
            if (eventsByDay[day].length > 0) {
                
                // CRITICAL FIX: Calculate the clean day target ONCE
                const cleanedDayTarget = day.replace(/[^a-zA-Z0-9]/g, '-');
                
                // Add Day Header with a Collapse Button
                eventsListContainer.innerHTML += `
                    <div class="day-header" data-day="${day}">
                        ${day}
                        <button class="collapse-btn" data-target="${cleanedDayTarget}" data-state="expanded">
                            <i class="fas fa-chevron-up"></i>
                        </button>
                    </div>
                `;
                
                // Sort events by time
                eventsByDay[day].sort((a, b) => a.time.localeCompare(b.time));
                
                eventsByDay[day].forEach(event => {
                    // Use the clean name as the primary class for reliable selection
                    eventsListContainer.innerHTML += `
                        <div class="event-card-wrapper ${cleanedDayTarget}"> 
                            ${createEventCardHTML(event)}
                        </div>
                    `;
                });
            }
        });

        // Re-attach all non-delegated listeners after new HTML is injected
        attachPollListeners();
        attachDeleteListeners();
        attachViewVotesListeners();
    };


    // --- ATTACH LISTENERS (RE-ATTACHED ON RENDER) ---
    
    const attachDeleteListeners = () => {
        document.querySelectorAll('.delete-event-btn').forEach(button => {
            button.onclick = function() {
                const eventIdToDelete = this.getAttribute('data-event-id');
                
                if (!confirm("Are you sure you want to delete this event? This action cannot be undone.")) {
                    return;
                }
                
                deleteEventFromDB(eventIdToDelete);
            };
        });
    };
    
    const attachPollListeners = () => {
        document.querySelectorAll('.poll-btn').forEach(button => {
            button.onclick = function() {
                if (!CURRENT_USER) {
                    alert("Please select your name from the 'Viewing As' dropdown first.");
                    return;
                }
                
                const pollElement = this.closest('.group-poll');
                const eventId = pollElement.getAttribute('data-event-id');
                const voteType = this.getAttribute('data-vote');
                const oppositeType = (voteType === 'yes' ? 'no' : 'yes');

                const eventObj = LIVE_EVENTS.find(e => e.id === eventId);

                if (eventObj) {
                    handleVoteUpdate(eventObj, voteType, oppositeType);
                }
            };
        });
    };

    /**
     * Attaches listeners for showing/hiding the full list of votes.
     */
    const attachViewVotesListeners = () => {
        document.querySelectorAll('.view-votes-btn').forEach(button => {
            button.onclick = function() {
                const card = this.closest('.event-card');
                const results = card.querySelector('.poll-results');
                const isHidden = results.getAttribute('data-visible') === 'false';
                
                if (isHidden) {
                    results.style.display = 'block';
                    results.setAttribute('data-visible', 'true');
                    this.textContent = 'Hide Other Votes';
                } else {
                    results.style.display = 'none';
                    results.setAttribute('data-visible', 'false');
                    this.textContent = 'View Other Votes';
                }
            };
        });
    };


    // --- PERMANENT FIX: Event Delegation for Collapse Button ---
    // This listener is attached ONCE and handles clicks on dynamically added buttons.
    eventsListContainer.addEventListener('click', (e) => {
        const button = e.target.closest('.collapse-btn');
        
        if (button) {
            const dayTargetClass = button.getAttribute('data-target');
            const currentState = button.getAttribute('data-state');
            
            // Select all wrappers using the clean class name
            const eventWrappers = document.querySelectorAll(`.${dayTargetClass}`);
            
            if (currentState === 'expanded') {
                eventWrappers.forEach(wrapper => {
                    wrapper.style.display = 'none'; 
                });
                button.setAttribute('data-state', 'collapsed');
                button.innerHTML = '<i class="fas fa-chevron-down"></i>';
            } else {
                eventWrappers.forEach(wrapper => {
                    wrapper.style.display = 'block'; 
                });
                button.setAttribute('data-state', 'expanded');
                button.innerHTML = '<i class="fas fa-chevron-up"></i>';
            }
        }
    });


    // --- INITIALIZATION & DATA LISTENER ---

    // 1. Set up the Tab Switching
    tabLinks.forEach(link => {
        link.addEventListener('click', () => {
            const targetTab = link.getAttribute('data-tab');
            tabLinks.forEach(l => l.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            link.classList.add('active');
            document.getElementById(targetTab).classList.add('active');
            // Only render events when switching to the daily plan tab
            if (targetTab === 'tab-daily') {
                renderAllEvents();
            }
        });
    });

    // 2. Set up the User Selector
    USERS.forEach(user => {
        const option = document.createElement('option');
        option.value = user;
        option.textContent = user;
        userSelect.appendChild(option);
    });
    document.getElementById('current-user-display').textContent = `(VOTING AS: ${CURRENT_USER})`;

    userSelect.addEventListener('change', (e) => {
        CURRENT_USER = e.target.value;
        document.getElementById('current-user-display').textContent = `(VOTING AS: ${CURRENT_USER})`;
        renderAllEvents(); // Re-render to update vote styling
    });
    
    // 3. New Event Form Handling
    addEventBtn.addEventListener('click', () => {
        addEventForm.style.display = 'block';
        addEventBtn.style.display = 'none';
    });
    
    cancelEventBtn.addEventListener('click', () => {
        addEventForm.style.display = 'none';
        addEventBtn.style.display = 'block';
        addEventForm.reset();
    });

    addEventForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        if (!CURRENT_USER) {
            alert("Please select your name from the 'Viewing As' dropdown before submitting an event.");
            return;
        }

        const newEvent = {
            day: document.getElementById('event-day').value,
            title: document.getElementById('event-title').value,
            time: document.getElementById('event-time').value,
            location: document.getElementById('event-location').value,
            votes: {
                yes: [CURRENT_USER],
                no: USERS.filter(user => user !== CURRENT_USER)
            }
        };

        addNewEventToDB(newEvent);
        
        addEventForm.style.display = 'none';
        addEventBtn.style.display = 'block';
        addEventForm.reset();
    });

    // 4. Firestore Real-Time Data Listener
    db.collection('events').onSnapshot(snapshot => {
        LIVE_EVENTS = snapshot.docs.map(doc => ({
            id: doc.id, // Use Firestore's generated document ID as the event ID
            ...doc.data()
        }));
        
        // Re-render the events list every time the database changes
        // This is the heart of the real-time application flow.
        renderAllEvents();
    }, error => {
        console.error("Firestore snapshot error:", error);
    });
    
    // 5. Initial Data Population (Manual one-time push - keep commented out unless needed)
    /*
    const initialEvents = [
        { day: 'Dec 14 (Sea)', title: 'Captain\'s Welcome Aboard Show', time: '7:30 PM - 8:30 PM (1 hr)', location: 'Theater (Decks 2 & 3)', votes: { yes: ["Ciara", "Chris", "Evan"], no: ["Abe", "Bryce", "Allen", "Koda"] } },
        { day: 'Dec 14 (Sea)', title: 'Late-Night DJ Set', time: '11:00 PM - 1:00 AM (2 hr)', location: 'The Crypt Nightclub', votes: { yes: ["Abe", "Chris", "Koda"], no: ["Ciara", "Bryce", "Evan", "Allen"] } },
        { day: 'Dec 15 (Port 1)', title: 'Group Dinner Reservation at Chops', time: '7:00 PM', location: 'Chops Grille (Deck 11)', votes: { yes: ["Abe", "Ciara", "Chris", "Bryce"], no: ["Evan", "Allen", "Koda"] } },
    ];
    // UNCOMMENT AND RUN THIS CODE ONCE IF YOUR DB IS EMPTY:
    // initialEvents.forEach(event => {
    //     db.collection('events').add(event);
    // });
    */
});