on run
    try
        do shell script "/bin/bash " & quoted form of "/Users/wjh/code/ball_screw/题库/launch.command" & " --background"
    on error errorMessage
        display alert "题库启动失败" message errorMessage as critical
    end try
end run
