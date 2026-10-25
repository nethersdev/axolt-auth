-- =========================================
-- AXOLT AUTH LOADER
-- =========================================

local SCRIPT_KEY = (getgenv and (getgenv().axolt_key or getgenv().Key)) or ""

if SCRIPT_KEY == "" then
    warn("[Axolt] Please set your key first: getgenv().axolt_key = 'YOUR_KEY'")
    game:GetService("Players").LocalPlayer:Kick("[Axolt] Missing key.")
    return
end

-- ✅ URL RENDER CONFIGURÉE
local API_URL = "https://axolt-auth.onrender.com/api/load" 
local BASE_URL = "https://axolt-auth.onrender.com"

local function httpPost(url, body)
    local HttpService = game:GetService("HttpService")
    local jsonBody = HttpService:JSONEncode(body)
    local headers = { ["Content-Type"] = "application/json" }

    if request then
        local res = request({ Url = url, Method = "POST", Headers = headers, Body = jsonBody })
        return res.Body
    end
    if http_request then
        local res = http_request({ Url = url, Method = "POST", Headers = headers, Body = jsonBody })
        return res.Body
    end
    if syn and syn.request then
        local res = syn.request({ Url = url, Method = "POST", Headers = headers, Body = jsonBody })
        return res.Body
    end
    return HttpService:PostAsync(url, jsonBody, Enum.HttpContentType.ApplicationJson)
end

local function httpGet(url)
    local HttpService = game:GetService("HttpService")
    if request then
        local res = request({ Url = url, Method = "GET" })
        return res.Body
    end
    if http_request then
        local res = http_request({ Url = url, Method = "GET" })
        return res.Body
    end
    if syn and syn.request then
        local res = syn.request({ Url = url, Method = "GET" })
        return res.Body
    end
    return HttpService:GetAsync(url)
end

local function getHWID()
    if gethwid then return gethwid() end
    if syn and syn.get_hwid then return syn.get_hwid() end
    if game.GetService then
        local ok, clientId = pcall(function()
            return game:GetService("RbxAnalyticsService"):GetClientId()
        end)
        if ok and clientId then return clientId end
    end
    local player = game:GetService("Players").LocalPlayer
    return tostring(player.UserId) .. "_" .. tostring(game.JobId)
end

local function kickPlayer(message)
    pcall(function()
        game:GetService("Players").LocalPlayer:Kick(message)
    end)
end

local function loadScript()
    local hwid = getHWID()
    
    local raw_guid = game:GetService("HttpService"):GenerateGUID(false)
    local session_id = string.gsub(raw_guid, "%-", "")

    local ok, response = pcall(function()
        return httpPost(API_URL, { key = SCRIPT_KEY, hwid = hwid, session_id = session_id })
    end)

    if not ok or not response then
        kickPlayer("[Axolt] invalid key")
        return
    end

    local decoded
    local ok2 = pcall(function()
        decoded = game:GetService("HttpService"):JSONDecode(response)
    end)

    if not ok2 or not decoded then
        kickPlayer("[Axolt] invalid key")
        return
    end

    if decoded.error then
        warn("[Axolt] " .. decoded.error)
        if string.find(decoded.error, "HWID") then
            kickPlayer("[Axolt] invalid hwid")
        elseif string.find(decoded.error, "banni") or string.find(decoded.error, "ban") then
            kickPlayer("[Axolt] you are banned")
        else
            kickPlayer("[Axolt] invalid key")
        end
        return
    end

    if not decoded.token then
        kickPlayer("[Axolt] failed to get token")
        return
    end

    local scriptUrl = BASE_URL .. "/script?token=" .. decoded.token .. "&session_id=" .. session_id

    local scriptOk, scriptBody = pcall(function()
        return httpGet(scriptUrl)
    end)

    if not scriptOk or not scriptBody then
        kickPlayer("[Axolt] failed to load script")
        return
    end

    if getgenv then
        getgenv().AxoltValidated = true
    end

    local func, err = loadstring(scriptBody)
    if not func then
        warn("[Axolt] Compilation error: " .. tostring(err))
        return
    end
    func()
end

loadScript()
