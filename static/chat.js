// load the YUI Javascript from Yahoo
new YAHOO.util.YUILoader({
    require: ["connection", "container", "fonts", "json", "yahoo-dom-event", "dragdrop"],
    combine: true, // combine the files
    filter: "MIN", // minimize them
    // once the includes are loaded, initialize the chat code
    onSuccess: function() { chat.init(); } // out callback function
}).insert();

// the basic object that we'll be using
var chat = {
    login_panel: false,
    user_id: false, // the current user
    user_name: false, // the current user name
    users: [], // all connected users
    user_count: 0, // the count of those users
    previous_typing_ping: 0,
    timeouts: {}
};

chat.init = function() {
    // setup the Onclick method
    YAHOO.util.Event.addListener("login-button", "click", chat.login);
    
    // turn the login div into a YUI panel
    chat.login_panel = new YAHOO.widget.Panel("login", {
        width: '230px',
        visible: true,
        close: false,
        constraintoviewport: true
    });
    
    chat.login_panel.render();
};

chat.login = function() {
    var username = document.getElementById('username').value;
    
    if(!username.length){
        chat.login_panel.setFooter("Please enter a username");
        return false;
    }
    
    // give the user feedback about what's happening
    chat.login_panel.setFooter('Logging in...');
    
    // setup the callback function and HTTP parameters
    var callback = { success: chat.login_success };
    
    // make ajax request
    YAHOO.util.Connect.asyncRequest('POST', '/login', callback, 'username='+username);
};

chat.login_success = function(ev) {
    // tell the user we got response
    chat.login_panel.setFooter('Success!');
    
    // wait a moment and then close the  login window
    setTimeout(function(){chat.login_panel.destroy()}, 500);
    
    // parse the response data and setup the chat object
    data = YAHOO.lang.JSON.parse(ev.responseText);
    chat.user_id = data.user_id;
    chat.user_name = data.user_name;
    
    // loop through the list of other users
    for(var x in data.users){
        var user = data.users[x];
        if(user.user_id != chat.user_id)
            chat.add_user(user);
    }
    
    // begin (long) polling the server for updates
    chat.poll();
};

chat.add_user = function(user){
    chat.user_count++; // keep track of the # of connected users
    
    var u = {};
    u.user_name = user.user_name;
    u.user_id = user.user_id;
    // setup the window
    u.panel = new YAHOO.widget.Panel('user-'+user.user_id, {
        width: '300px',
        constraintoviewport: true,
        x: chat.user_count * 50,
        y: chat.user_count * 50
    });
    
    // set the title of the window
    u.panel.setHeader('Chatting with '+user.user_name);
    
    // add content div, where we'll display the chat
    var content = document.createElement('div');
    content.setAttribute('id', 'chat-'+user.user_id);
    u.panel.appendToBody(content);
    
    // the textarea we'll use to send messages to this user
    var textarea = document.createElement('textarea');
    textarea.setAttribute('cols', 36);
    textarea.setAttribute('id', 'text-'+user.user_id);
    u.panel.appendToBody(textarea);
    
    // show the online status and hide it after half a second
    u.panel.setFooter('Online...');
    setTimeout(function(){u.panel.setFooter('')}, 500);
    
    // keep track of all of the connected users
    chat.users[user.user_id] = u;
    // render the window
    u.panel.render('container');
    
    // listen for keypresses
    YAHOO.util.Event.addListener('text-' + user.user_id, 'keypress', chat.keypress);
};

chat.poll = function(){
    var callback = { success: chat.handle_updates };
    YAHOO.util.Connect.asyncRequest('POST', '/updates', callback, 'user_id='+chat.user_id);
};

chat.handle_updates = function(ev){
    // parse the JSON
    var message = YAHOO.lang.JSON.parse(ev.responseText);
    
    // if it's a login request, add user to the screen
    if(message.type == 'login'){
        chat.add_user(message.data);
        chat.poll(); // keep polling
    }else if(message.type == 'sent'){
        //clear the textarea
        var input = document.getElementById('text-' + message.data.to_user_id);
        input.value = '';
        input.focus();
        // show the message
        chat.append_message(message.data);
    }else if(message.type == 'message'){
        chat.append_message(message.data);
        chat.poll(); // keep polling
        
        // clear the typing timeout
        var u = chat.users[message.data.from_user_id];
        clearTimeout(chat.timeouts[u.user_id]);
        // clear the footer status
        u.panel.setFooter('');
    }else if(message.type == 'typing'){
        //get the user
        var u = chat.users[message.data.from_user_id];
        u.panel.setFooter(u.user_name + ' is typing...');
        // clear any existing timeouts
        clearTimeout(chat.timeouts[u.user_id]);
        // setup a new timeout
        chat.timeouts[u.user_id] = setTimeout(function(){
            u.panel.setFooter(u.user_name + ' typed...');
        }, 3000);
        chat.poll(); // keep polling dude!
    }
};

chat.keypress = function(ev){
    // the ev.target is the textarea field
    var textarea = ev.target;
    
    // parse the user_id from textarea id
    var to_user_id = textarea.id.replace('text-', '');
    
    // setup the basic AJAX HTTP parameters (to and from)
    var params = 'from_user_id=' + chat.user_id;
    params += '&to_user_id=' + to_user_id;
    
    // did they press the enter key?
    if(ev.keyCode && (ev.keyCode == 13)){
        // add the message text to the parameters
        params += '&text=' + textarea.value;
        
        // reuse the handle_updates method and run the ajax
        var callback = { success: chat.handle_updates };
        YAHOO.util.Connect.asyncRequest('POST', '/send', callback, params);
    }else{
        // the current time, in milliseconds since 1970
        var now = new Date().getTime();
        
        // ping every 1.5 seconds (1500 milliseconds)
        if((now - chat.previous_typing_ping) > 1500){
            // update the "previous" time
            chat.previous_typing_ping = now;
            // notify the server
            YAHOO.util.Connect.asyncRequest('POST', '/typing', false, params);
        }
    }
};

chat.append_message = function(data){
    // the user that send the message
    var user_id = data.from_user_id;
    
    // the display name of who sent the message
    var from_user_name = '';
    
    // if it's from the current user, append it to the 'to' user box.
    if(user_id == chat.user_id){
        user_id = data.to_user_id;
        from_user_name = 'You'; // it's from you, not them
    }else
        from_user_name = chat.users[user_id].user_name;
        
    var doc = document;
    var div = doc.createElement('div'); // create the HTML element
    
    // insert the message text into the message div
    div.appendChild(doc.createTextNode(from_user_name + ': ' + data.text));
    
    // get the content div
    var contentDiv = doc.getElementById('chat-' + user_id);
    
    // append the content
    contentDiv.appendChild(div);
    
    // ensure the window is scrolled down to the newest message
    contentDiv.scrollTop = contentDiv.scrollHeight;
};